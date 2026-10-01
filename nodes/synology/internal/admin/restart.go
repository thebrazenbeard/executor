package admin

import (
	"errors"
	"sync"
	"time"
)

type Replacement interface {
	Ready() <-chan error
	Connected() <-chan struct{}
	Release() error
	Kill() error
}

type ReplacementLauncher interface {
	Launch() (Replacement,error)
}

type RestartCoordinator struct {
	launcher ReplacementLauncher
	shutdown func()
	timeout time.Duration
}

func NewRestartCoordinator(launcher ReplacementLauncher, shutdown func(), timeout time.Duration)*RestartCoordinator{
	if timeout<=0{timeout=30*time.Second}
	if shutdown==nil{shutdown=func(){}}
	return &RestartCoordinator{launcher:launcher,shutdown:shutdown,timeout:timeout}
}

func(r *RestartCoordinator)Prepare()(func(),error){
	if r.launcher==nil{return nil,errors.New("restart launcher is unavailable")}
	replacement,err:=r.launcher.Launch()
	if err!=nil{return nil,err}
	if replacement==nil{return nil,errors.New("restart launcher returned no replacement")}

	readyTimer:=time.NewTimer(r.timeout)
	defer readyTimer.Stop()
	select{
	case err:=<-replacement.Ready():
		if err!=nil{_ = replacement.Kill();return nil,err}
	case <-readyTimer.C:
		_ = replacement.Kill()
		return nil,errors.New("replacement did not become locally ready")
	}

	var once sync.Once
	after:=func(){
		once.Do(func(){
			if err:=replacement.Release();err!=nil{
				_ = replacement.Kill()
				return
			}
			go func(){
				timer:=time.NewTimer(r.timeout)
				defer timer.Stop()
				select{
				case <-replacement.Connected():
					r.shutdown()
				case <-timer.C:
					_ = replacement.Kill()
				}
			}()
		})
	}
	return after,nil
}
