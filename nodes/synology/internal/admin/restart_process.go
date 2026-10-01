package admin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	RestartGateEnv      = "EXECUTOR_RESTART_GATE_FILE"
	RestartReadyEnv     = "EXECUTOR_RESTART_READY_FILE"
	RestartConnectedEnv = "EXECUTOR_RESTART_CONNECTED_FILE"
)

type RestartChildBarrier struct {
	gate      string
	ready     string
	connected string
}

func LoadRestartChildBarrierFromEnv() (*RestartChildBarrier,bool) {
	gate:=os.Getenv(RestartGateEnv)
	ready:=os.Getenv(RestartReadyEnv)
	connected:=os.Getenv(RestartConnectedEnv)
	if gate==""||ready==""||connected=="" { return nil,false }
	_ = os.Unsetenv(RestartGateEnv)
	_ = os.Unsetenv(RestartReadyEnv)
	_ = os.Unsetenv(RestartConnectedEnv)
	return &RestartChildBarrier{gate:gate,ready:ready,connected:connected},true
}

func atomicMarker(path string,data []byte) error {
	dir:=filepath.Dir(path)
	if err:=os.MkdirAll(dir,0o700);err!=nil{return err}
	tmp,err:=os.CreateTemp(dir,".marker-*")
	if err!=nil{return err}
	tmpName:=tmp.Name()
	defer os.Remove(tmpName)
	if err:=tmp.Chmod(0o600);err!=nil{_ = tmp.Close();return err}
	if _,err:=tmp.Write(data);err!=nil{_ = tmp.Close();return err}
	if err:=tmp.Sync();err!=nil{_ = tmp.Close();return err}
	if err:=tmp.Close();err!=nil{return err}
	return os.Rename(tmpName,path)
}

func(b *RestartChildBarrier)SignalReadyAndWait(ctx context.Context) error {
	if b==nil{return nil}
	if err:=atomicMarker(b.ready,[]byte("ready"));err!=nil{return err}
	ticker:=time.NewTicker(10*time.Millisecond);defer ticker.Stop()
	for{
		data,err:=os.ReadFile(b.gate)
		if err==nil&&strings.TrimSpace(string(data))=="go"{return nil}
		if err!=nil&&!errors.Is(err,os.ErrNotExist){return err}
		select{
		case<-ctx.Done():return ctx.Err()
		case<-ticker.C:
		}
	}
}

func(b *RestartChildBarrier)MarkConnected(generation int) error {
	if b==nil{return nil}
	if generation<=0{return errors.New("connected generation must be positive")}
	return atomicMarker(b.connected,[]byte(strconv.Itoa(generation)))
}

type OSReplacementLauncherConfig struct {
	Executable   string
	Args         []string
	Env          []string
	TempDir      string
	PollInterval time.Duration
}

type OSReplacementLauncher struct { cfg OSReplacementLauncherConfig }

func NewOSReplacementLauncher(cfg OSReplacementLauncherConfig)*OSReplacementLauncher{
	if cfg.PollInterval<=0{cfg.PollInterval=20*time.Millisecond}
	return &OSReplacementLauncher{cfg:cfg}
}

type osReplacement struct {
	cmd *exec.Cmd
	dir string
	gate string
	readyPath string
	connectedPath string
	poll time.Duration
	ready chan error
	connected chan struct{}
	done chan error
	releaseOnce sync.Once
	killOnce sync.Once
	connectedOnce sync.Once
}

func filterRestartEnv(env []string) []string {
	prefixes:=[]string{RestartGateEnv+"=",RestartReadyEnv+"=",RestartConnectedEnv+"="}
	out:=make([]string,0,len(env))
	for _,entry:=range env{
		skip:=false
		for _,prefix:=range prefixes{if strings.HasPrefix(entry,prefix){skip=true;break}}
		if !skip{out=append(out,entry)}
	}
	return out
}

func(l *OSReplacementLauncher)Launch()(Replacement,error){
	if l==nil||strings.TrimSpace(l.cfg.Executable)==""{return nil,errors.New("replacement executable is required")}
	dir,err:=os.MkdirTemp(l.cfg.TempDir,"executor-restart-")
	if err!=nil{return nil,err}
	gate:=filepath.Join(dir,"gate")
	readyPath:=filepath.Join(dir,"ready")
	connectedPath:=filepath.Join(dir,"connected")
	env:=l.cfg.Env
	if env==nil{env=os.Environ()}
	env=filterRestartEnv(env)
	env=append(env,RestartGateEnv+"="+gate,RestartReadyEnv+"="+readyPath,RestartConnectedEnv+"="+connectedPath)

	cmd:=exec.Command(l.cfg.Executable,l.cfg.Args...)
	cmd.Env=env
	cmd.Stdout=os.Stdout
	cmd.Stderr=os.Stderr
	if err:=cmd.Start();err!=nil{_ = os.RemoveAll(dir);return nil,err}

	r:=&osReplacement{
		cmd:cmd,dir:dir,gate:gate,readyPath:readyPath,connectedPath:connectedPath,poll:l.cfg.PollInterval,
		ready:make(chan error,1),connected:make(chan struct{}),done:make(chan error,1),
	}
	go func(){r.done<-cmd.Wait();close(r.done)}()
	go r.watchReady()
	go r.watchConnected()
	return r,nil
}

func(r *osReplacement)watchReady(){
	ticker:=time.NewTicker(r.poll);defer ticker.Stop()
	for{
		if _,err:=os.Stat(r.readyPath);err==nil{r.ready<-nil;return}else if !errors.Is(err,os.ErrNotExist){r.ready<-err;return}
		select{
		case err:=<-r.done:
			if _,statErr:=os.Stat(r.readyPath);statErr==nil{r.ready<-nil}else{r.ready<-fmt.Errorf("replacement exited before ready: %v",err)}
			return
		case<-ticker.C:
		}
	}
}

func(r *osReplacement)watchConnected(){
	ticker:=time.NewTicker(r.poll);defer ticker.Stop()
	for{
		if _,err:=os.Stat(r.connectedPath);err==nil{
			r.connectedOnce.Do(func(){close(r.connected)})
			_ = os.RemoveAll(r.dir)
			return
		}
		select{
		case<-r.done:
			if _,err:=os.Stat(r.connectedPath);err==nil{
				r.connectedOnce.Do(func(){close(r.connected)})
				_ = os.RemoveAll(r.dir)
			}
			return
		case<-ticker.C:
		}
	}
}

func(r *osReplacement)Ready()<-chan error{return r.ready}
func(r *osReplacement)Connected()<-chan struct{}{return r.connected}

func(r *osReplacement)Release()error{
	var result error
	r.releaseOnce.Do(func(){result=atomicMarker(r.gate,[]byte("go"))})
	return result
}

func(r *osReplacement)Kill()error{
	var result error
	r.killOnce.Do(func(){
		if r.cmd!=nil&&r.cmd.Process!=nil{
			err:=r.cmd.Process.Kill()
			if err!=nil&&!errors.Is(err,os.ErrProcessDone){result=err}
		}
		_ = os.RemoveAll(r.dir)
	})
	return result
}
