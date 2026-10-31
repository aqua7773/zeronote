## Default Permission

ZeroNote APK 安装插件：把下载好的 APK 交给 Android 系统安装器（`ACTION_VIEW` +
`application/vnd.android.package-archive`），并提供「安装未知应用」授权的查询与跳转。

桌面端返回 `desktop-no-apk-install` —— 桌面的更新走官方 updater（带签名校验）。

#### This default permission set includes the following:

- `allow-install-apk`
- `allow-can-install-apk`
- `allow-open-install-settings`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`apk-install:allow-can-install-apk`

</td>
<td>

Enables the can_install_apk command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`apk-install:deny-can-install-apk`

</td>
<td>

Denies the can_install_apk command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`apk-install:allow-install-apk`

</td>
<td>

Enables the install_apk command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`apk-install:deny-install-apk`

</td>
<td>

Denies the install_apk command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`apk-install:allow-open-install-settings`

</td>
<td>

Enables the open_install_settings command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`apk-install:deny-open-install-settings`

</td>
<td>

Denies the open_install_settings command without any pre-configured scope.

</td>
</tr>
</table>
