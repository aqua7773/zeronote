## Default Permission

ZeroNote 状态栏插件：允许前端按需隐藏 / 显示 Android 状态栏（导航栏不受影响），
以及长按到点时的轻震动（`vibrate` —— WebView 的 `navigator.vibrate` 在国产 ROM 上不可靠）。

#### This default permission set includes the following:

- `allow-set-status-bar-visible`
- `allow-vibrate`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`statusbar:allow-set-status-bar-visible`

</td>
<td>

Enables the set_status_bar_visible command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`statusbar:deny-set-status-bar-visible`

</td>
<td>

Denies the set_status_bar_visible command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`statusbar:allow-vibrate`

</td>
<td>

Enables the vibrate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`statusbar:deny-vibrate`

</td>
<td>

Denies the vibrate command without any pre-configured scope.

</td>
</tr>
</table>
