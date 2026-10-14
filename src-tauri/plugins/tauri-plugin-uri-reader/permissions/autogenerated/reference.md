## Default Permission

ZeroNote URI 读取插件：允许前端把 Android 系统递来的 `content://`（SAF）文件
读成应用缓存里的一份临时文件（返回 { path, name }）。

用途：从文件管理器「用 ZeroNote 打开」**其他目录**里的 md / pdf —— Rust 的 std::fs 读不了
content://，只有 Android 的 ContentResolver 能，所以必须走这条原生通道。

#### This default permission set includes the following:

- `allow-read-content-uri`
- `allow-register-listener`
- `allow-remove-listener`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`uri-reader:allow-read-content-uri`

</td>
<td>

Enables the read_content_uri command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`uri-reader:deny-read-content-uri`

</td>
<td>

Denies the read_content_uri command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`uri-reader:allow-register-listener`

</td>
<td>

Enables the register_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`uri-reader:deny-register-listener`

</td>
<td>

Denies the register_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`uri-reader:allow-remove-listener`

</td>
<td>

Enables the remove_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`uri-reader:deny-remove-listener`

</td>
<td>

Denies the remove_listener command without any pre-configured scope.

</td>
</tr>
</table>
