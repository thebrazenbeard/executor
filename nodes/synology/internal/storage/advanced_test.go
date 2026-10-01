package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCopyMoveHashAndSpace(t *testing.T) {
	left := t.TempDir()
	right := t.TempDir()
	m, err := NewManager([]RootConfig{
		{ID:"left",Path:left,Mode:"rw"},
		{ID:"right",Path:right,Mode:"rw"},
	})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	payload := []byte(strings.Repeat("executor-", 10000))
	if err := os.Mkdir(filepath.Join(left,"docs"),0700); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(left,"docs","source.txt"),payload,0600); err != nil { t.Fatal(err) }

	copied, err := m.Copy("left","docs/source.txt","right","copy.txt",false)
	if err != nil { t.Fatal(err) }
	if copied.Size != int64(len(payload)) { t.Fatalf("copy meta=%+v", copied) }

	sum, err := m.Hash("right","copy.txt")
	if err != nil { t.Fatal(err) }
	want := sha256.Sum256(payload)
	if sum != hex.EncodeToString(want[:]) { t.Fatalf("hash=%s",sum) }

	if _, err := m.Copy("left","docs/source.txt","right","copy.txt",false); err == nil {
		t.Fatal("copy unexpectedly overwrote destination")
	}

	same, err := m.Move("left","docs/source.txt","left","docs/moved.txt",false)
	if err != nil { t.Fatal(err) }
	if !same.Atomic { t.Fatalf("same-root move must be atomic: %+v",same) }
	if _, err := os.Stat(filepath.Join(left,"docs","source.txt")); !os.IsNotExist(err) { t.Fatalf("source remains: %v",err) }

	cross, err := m.Move("left","docs/moved.txt","right","moved.txt",false)
	if err != nil { t.Fatal(err) }
	if cross.Atomic { t.Fatalf("cross-root move cannot claim atomic: %+v",cross) }
	if _, err := os.Stat(filepath.Join(left,"docs","moved.txt")); !os.IsNotExist(err) { t.Fatalf("source remains: %v",err) }

	space, err := m.Space("right")
	if err != nil { t.Fatal(err) }
	if space.TotalBytes == 0 || space.AvailableBytes > space.TotalBytes { t.Fatalf("space=%+v",space) }
}

func TestCopyMoveRejectSymlinksAndCleanInterruptedDestination(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	m, err := NewManager([]RootConfig{{ID:"media",Path:root,Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	if err := os.WriteFile(filepath.Join(root,"source.txt"),[]byte("source"),0600); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(outside,"secret.txt"),[]byte("secret"),0600); err != nil { t.Fatal(err) }
	if err := os.Symlink(filepath.Join(outside,"secret.txt"),filepath.Join(root,"escape")); err != nil { t.Fatal(err) }

	if _, err := m.Copy("media","escape","media","copied.txt",false); err == nil { t.Fatal("copied symlink source") }
	if _, err := m.Copy("media","source.txt","media","escape",true); err == nil { t.Fatal("overwrote symlink destination") }
	if _, err := m.Move("media","escape","media","moved.txt",false); err == nil { t.Fatal("moved symlink source") }

	if err := os.Mkdir(filepath.Join(root,"blocked"),0700); err != nil { t.Fatal(err) }
	if _, err := m.Copy("media","source.txt","media","blocked",true); err == nil { t.Fatal("expected copy-to-directory failure") }
	matches, err := filepath.Glob(filepath.Join(root,".executor-copy-*"))
	if err != nil { t.Fatal(err) }
	if len(matches) != 0 { t.Fatalf("temporary files leaked after failed copy: %v",matches) }
}

func TestSearchIsLiteralBoundedAndDoesNotFollowSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(root,"docs"),0700); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(root,"docs","Alpha.txt"),[]byte("needle across content"),0600); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(root,"docs","literal[1].txt"),[]byte("brackets are literal"),0600); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(outside,"secret.txt"),[]byte("needle"),0600); err != nil { t.Fatal(err) }
	if err := os.Symlink(outside,filepath.Join(root,"docs","outside")); err != nil { t.Fatal(err) }

	m, err := NewManager([]RootConfig{{ID:"media",Path:root,Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	names, err := m.Search("media","docs","name","literal[1]",100)
	if err != nil { t.Fatal(err) }
	if len(names)!=1 || names[0].Path!="docs/literal[1].txt" { t.Fatalf("names=%+v",names) }

	content, err := m.Search("media","docs","content","needle",100)
	if err != nil { t.Fatal(err) }
	if len(content)!=1 || content[0].Path!="docs/Alpha.txt" { t.Fatalf("content=%+v",content) }

	if _, err := m.Search("media","docs","name",".*",100); err != nil { t.Fatal(err) }
	regexLike, _ := m.Search("media","docs","name",".*",100)
	if len(regexLike)!=0 { t.Fatalf("query behaved as regex: %+v",regexLike) }

	if _, err := m.Search("media","docs","name","x",1001); err == nil { t.Fatal("limit >1000 accepted") }
}

func TestLargeOperationsUseBoundedStreamingBuffer(t *testing.T) {
	if StreamingBufferBytes > 1024*1024 { t.Fatalf("streaming buffer too large: %d",StreamingBufferBytes) }

	root := t.TempDir()
	m, err := NewManager([]RootConfig{{ID:"media",Path:root,Mode:"rw"}})
	if err != nil { t.Fatal(err) }
	defer m.Close()

	big := filepath.Join(root,"big.bin")
	f, err := os.Create(big)
	if err != nil { t.Fatal(err) }
	if err := f.Truncate(64*1024*1024); err != nil { _=f.Close(); t.Fatal(err) }
	if _, err := f.WriteAt([]byte("needle"), 32*1024*1024); err != nil { _=f.Close(); t.Fatal(err) }
	if err := f.Close(); err != nil { t.Fatal(err) }

	if _, err := m.Copy("media","big.bin","media","big-copy.bin",false); err != nil { t.Fatal(err) }
	if _, err := m.Hash("media","big-copy.bin"); err != nil { t.Fatal(err) }

	recursive, err := m.Search("media","","content","needle",100)
	if err != nil { t.Fatal(err) }
	for _, result := range recursive {
		if result.Path=="big.bin" || result.Path=="big-copy.bin" { t.Fatalf("recursive content search did not skip >16MiB file: %+v",recursive) }
	}
	direct, err := m.Search("media","big.bin","content","needle",100)
	if err != nil { t.Fatal(err) }
	if len(direct)!=1 || direct[0].Path!="big.bin" { t.Fatalf("direct large-file search=%+v",direct) }
}
