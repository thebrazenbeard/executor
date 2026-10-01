package admin

import (
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeReplacement struct {
	ready chan error
	connected chan struct{}
	releaseCount int
	killCount int
	mu sync.Mutex
	connectOnRelease bool
}
func newFakeReplacement(connect bool)*fakeReplacement{
	r:=&fakeReplacement{ready:make(chan error,1),connected:make(chan struct{}),connectOnRelease:connect}
	r.ready<-nil
	return r
}
func(f *fakeReplacement)Ready()<-chan error{return f.ready}
func(f *fakeReplacement)Connected()<-chan struct{}{return f.connected}
func(f *fakeReplacement)Release()error{
	f.mu.Lock();defer f.mu.Unlock();f.releaseCount++
	if f.connectOnRelease && f.releaseCount==1{close(f.connected)}
	return nil
}
func(f *fakeReplacement)Kill()error{f.mu.Lock();defer f.mu.Unlock();f.killCount++;return nil}

type fakeLauncher struct{replacement Replacement;err error;launchCount int}
func(f *fakeLauncher)Launch() (Replacement,error){f.launchCount++;return f.replacement,f.err}

func TestRestartHandoffTwentyCyclesStartsAndShutsDownExactlyOnce(t *testing.T){
	for i:=0;i<20;i++{
		replacement:=newFakeReplacement(true)
		launcher:=&fakeLauncher{replacement:replacement}
		shutdowns:=0
		coord:=NewRestartCoordinator(launcher,func(){shutdowns++},100*time.Millisecond)
		after,err:=coord.Prepare()
		if err!=nil{t.Fatalf("cycle %d prepare: %v",i,err)}
		if launcher.launchCount!=1||shutdowns!=0{t.Fatalf("cycle %d premature state launch=%d shutdown=%d",i,launcher.launchCount,shutdowns)}
		after()
		after()
		deadline:=time.Now().Add(time.Second)
		for shutdowns!=1&&time.Now().Before(deadline){time.Sleep(time.Millisecond)}
		if shutdowns!=1{t.Fatalf("cycle %d shutdowns=%d",i,shutdowns)}
		if replacement.releaseCount!=1{t.Fatalf("cycle %d releases=%d",i,replacement.releaseCount)}
		if replacement.killCount!=0{t.Fatalf("cycle %d kills=%d",i,replacement.killCount)}
	}
}

func TestRestartStartupFailureLeavesParentAlive(t *testing.T){
	launcher:=&fakeLauncher{err:errors.New("start failed")}
	shutdowns:=0
	coord:=NewRestartCoordinator(launcher,func(){shutdowns++},20*time.Millisecond)
	if _,err:=coord.Prepare();err==nil{t.Fatal("expected prepare failure")}
	if shutdowns!=0{t.Fatal("parent shut down after child start failure")}
}

func TestRestartConnectionTimeoutKillsReplacementAndLeavesParent(t *testing.T){
	replacement:=newFakeReplacement(false)
	launcher:=&fakeLauncher{replacement:replacement}
	shutdowns:=0
	coord:=NewRestartCoordinator(launcher,func(){shutdowns++},20*time.Millisecond)
	after,err:=coord.Prepare();if err!=nil{t.Fatal(err)}
	after()
	deadline:=time.Now().Add(time.Second)
	for replacement.killCount==0&&time.Now().Before(deadline){time.Sleep(time.Millisecond)}
	if replacement.killCount!=1{t.Fatalf("killCount=%d",replacement.killCount)}
	if shutdowns!=0{t.Fatalf("parent shutdowns=%d",shutdowns)}
}

func TestRestartReadyFailureKillsReplacementBeforeApplyResponse(t *testing.T){
	replacement:=newFakeReplacement(false)
	replacement.ready=make(chan error,1);replacement.ready<-errors.New("child init failed")
	launcher:=&fakeLauncher{replacement:replacement}
	coord:=NewRestartCoordinator(launcher,func(){t.Fatal("unexpected shutdown")},time.Second)
	if _,err:=coord.Prepare();err==nil{t.Fatal("expected child init failure")}
	if replacement.killCount!=1{t.Fatalf("killCount=%d",replacement.killCount)}
}
