## Default Permission

ZeroNote 分享插件：把一段**纯文本**交给 Android 系统分享面板
（`Intent.ACTION_SEND` / `text/plain`）—— 微信 / QQ / 邮件 / 备忘录都能接收。

桌面端**没有系统分享**，调用会返回 `desktop-no-share` 错误（调用方据此改走剪贴板），
不做静默成功。

#### This default permission set includes the following:

- `allow-share-text`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`share:allow-share-text`

</td>
<td>

Enables the share_text command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`share:deny-share-text`

</td>
<td>

Denies the share_text command without any pre-configured scope.

</td>
</tr>
</table>
