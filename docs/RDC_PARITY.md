# Remote Desktop Commander parity target

Reference inspected: `desktop-commander/remote-desktop-commander@b480501dcca59f802ebaf97f2f57b45252d0b720`.

Executor should preserve the practical remote-workstation experience: remote MCP access, full file read/write/edit/search, arbitrary command execution, interactive process sessions, process inspection/control, multiple connected workstations, explicit workstation selection, device status, and the Desktop Commander config/history/document tools.

Executor adds an operator-controlled tunnel path, 8 parallel execution lanes per device, 64 parallel logic lanes, connection-generation fencing, explicit effect disposition, no silent replay of ambiguous mutations, and exact in-repo provenance.

The RDC hosted service implementation is not incorporated here. Effective throughput remains bounded by the infrastructure actually in use.
