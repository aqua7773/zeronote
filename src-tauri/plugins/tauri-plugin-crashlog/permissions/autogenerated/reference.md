## Default Permission

ZeroNote 崩溃日志插件：允许前端读取「上一次异常退出」的系统记录（Android ApplicationExitInfo），
原生崩溃时含 tombstone 全文。用于崩溃后自动复制堆栈到剪贴板、让用户一键反馈。

#### This default permission set includes the following:

- `allow-read-last-crash`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`crashlog:allow-read-last-crash`

</td>
<td>

Enables the read_last_crash command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`crashlog:deny-read-last-crash`

</td>
<td>

Denies the read_last_crash command without any pre-configured scope.

</td>
</tr>
</table>
