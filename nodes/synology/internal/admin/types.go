package admin

type SystemInfo struct {
	Hostname          string            `json:"hostname"`
	Version           map[string]string `json:"version"`
	UptimeSeconds     float64           `json:"uptimeSeconds"`
	Load1             float64           `json:"load1"`
	Load5             float64           `json:"load5"`
	Load15            float64           `json:"load15"`
	MemoryTotalKB     uint64            `json:"memoryTotalKB"`
	MemoryAvailableKB uint64            `json:"memoryAvailableKB"`
}

type VolumeInfo struct {
	Source         string `json:"source"`
	MountPoint     string `json:"mountPoint"`
	Filesystem     string `json:"filesystem"`
	TotalBytes     uint64 `json:"totalBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}

type StorageInfo struct { Volumes []VolumeInfo `json:"volumes"` }

type NetworkInterface struct {
	Name    string `json:"name"`
	State   string `json:"state"`
	Address string `json:"address"`
}
type NetworkInfo struct { Interfaces []NetworkInterface `json:"interfaces"` }

type PackageInfo struct {
	Package     string `json:"package"`
	Version     string `json:"version"`
	DisplayName string `json:"displayName"`
}
type PackageStatus struct { Packages []PackageInfo `json:"packages"` }

type UserInfo struct {
	Name string `json:"name"`
	UID  int    `json:"uid"`
	GID  int    `json:"gid"`
	Home string `json:"home"`
	Shell string `json:"shell"`
}
type GroupInfo struct {
	Name    string   `json:"name"`
	GID     int      `json:"gid"`
	Members []string `json:"members"`
}
type UserGroupInfo struct {
	Users  []UserInfo  `json:"users"`
	Groups []GroupInfo `json:"groups"`
}

type SharedFolder struct {
	Name string `json:"name"`
	Path string `json:"path"`
}
type SharedFolderInfo struct { Shares []SharedFolder `json:"shares"` }

type UpdateInfo struct {
	Current  map[string]string `json:"current"`
	Defaults map[string]string `json:"defaults"`
}
