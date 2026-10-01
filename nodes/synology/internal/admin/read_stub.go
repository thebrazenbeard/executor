//go:build !linux

package admin

import "errors"

var errDSMReaderUnsupported = errors.New("DSM admin reader requires Linux")

type Reader struct{}

func NewReader(string) *Reader { return &Reader{} }

func (*Reader) SystemInfo() (SystemInfo, error) { return SystemInfo{}, errDSMReaderUnsupported }
func (*Reader) StorageInfo() (StorageInfo, error) { return StorageInfo{}, errDSMReaderUnsupported }
func (*Reader) NetworkInfo() (NetworkInfo, error) { return NetworkInfo{}, errDSMReaderUnsupported }
func (*Reader) PackageStatus() (PackageStatus, error) { return PackageStatus{}, errDSMReaderUnsupported }
func (*Reader) UserGroupInfo() (UserGroupInfo, error) { return UserGroupInfo{}, errDSMReaderUnsupported }
func (*Reader) SharedFolderInfo() (SharedFolderInfo, error) { return SharedFolderInfo{}, errDSMReaderUnsupported }
func (*Reader) UpdateInfo() (UpdateInfo, error) { return UpdateInfo{}, errDSMReaderUnsupported }
