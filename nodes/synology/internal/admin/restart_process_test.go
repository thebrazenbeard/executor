package admin

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRestartReplacementHelper(t *testing.T){
	if os.Getenv("EXECUTOR_TEST_RESTART_HELPER")!="1"{return}
	barrier,ok:=LoadRestartChildBarrierFromEnv()
	if !ok{os.Exit(21)}
	ctx,cancel:=context.WithTimeout(context.Background(),3*time.Second)
	defer cancel()
	if err:=barrier.SignalReadyAndWait(ctx);err!=nil{os.Exit(22)}
	if err:=barrier.MarkConnected(42);err!=nil{os.Exit(23)}
	os.Exit(0)
}

func TestOSReplacementLauncherUsesReadyGateThenConnectedMarker(t *testing.T){
	launcher:=NewOSReplacementLauncher(OSReplacementLauncherConfig{
		Executable:os.Args[0],
		Args:[]string{"-test.run=TestRestartReplacementHelper"},
		Env:append(os.Environ(),"EXECUTOR_TEST_RESTART_HELPER=1"),
		TempDir:t.TempDir(),
		PollInterval:5*time.Millisecond,
	})
	replacement,err:=launcher.Launch()
	if err!=nil{t.Fatal(err)}
	select{
	case err:=<-replacement.Ready():
		if err!=nil{t.Fatal(err)}
	case<-time.After(2*time.Second):t.Fatal("replacement never became locally ready")
	}
	select{
	case<-replacement.Connected():t.Fatal("replacement connected before response release")
	case<-time.After(50*time.Millisecond):
	}
	if err:=replacement.Release();err!=nil{t.Fatal(err)}
	select{
	case<-replacement.Connected():
	case<-time.After(2*time.Second):t.Fatal("replacement did not report connected")
	}
}

func TestChildBarrierUnsetsRestartEnvironmentAndWritesGeneration(t *testing.T){
	dir:=t.TempDir()
	gate:=filepath.Join(dir,"gate")
	ready:=filepath.Join(dir,"ready")
	connected:=filepath.Join(dir,"connected")
	t.Setenv(RestartGateEnv,gate)
	t.Setenv(RestartReadyEnv,ready)
	t.Setenv(RestartConnectedEnv,connected)

	barrier,ok:=LoadRestartChildBarrierFromEnv()
	if !ok{t.Fatal("restart barrier not detected")}
	for _,key:=range []string{RestartGateEnv,RestartReadyEnv,RestartConnectedEnv}{
		if os.Getenv(key)!=""{t.Fatalf("%s remained in child environment",key)}
	}

	ctx,cancel:=context.WithTimeout(context.Background(),time.Second)
	defer cancel()
	done:=make(chan error,1)
	go func(){done<-barrier.SignalReadyAndWait(ctx)}()
	for deadline:=time.Now().Add(time.Second);;{
		if _,err:=os.Stat(ready);err==nil{break}
		if time.Now().After(deadline){t.Fatal("ready marker missing")}
		time.Sleep(time.Millisecond)
	}
	if err:=os.WriteFile(gate,[]byte("go"),0600);err!=nil{t.Fatal(err)}
	if err:=<-done;err!=nil{t.Fatal(err)}
	if err:=barrier.MarkConnected(17);err!=nil{t.Fatal(err)}
	data,err:=os.ReadFile(connected);if err!=nil{t.Fatal(err)}
	if string(data)!="17"{t.Fatalf("connected marker=%q",data)}
}
