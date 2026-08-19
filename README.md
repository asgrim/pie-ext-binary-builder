# Generate Pre-Packaged Binaries for PIE Extensions

This is a GitHub action designed to help generate pre-packaged binaries for
[PIE (PHP Installer for Extensions)](https://github.com/php/pie) extensions and attach
them to your GitHub releases. It will:

 - Build a `.so` from your extension
 - Package the `.so` in an archive, and name it according to PIE's expectations
 - Upload the archive to your GitHub release
 - Optionally upload the archive as a workflow build artifact

> [!TIP]
> Looking for Windows support? You probably want [`php/php-windows-builder`](https://github.com/php/php-windows-builder?tab=readme-ov-file#examples)

## The Action

You must specify a `release-tag`. This is a tag, for which you have created
a release ready for the action to upload the builds to.

> [!IMPORTANT]
> If you have enabled immutable releases on your repository, the release must be
> a draft release, otherwise uploading the assets will fail.

```yaml
uses: php/pie-ext-binary-builder@0.0.2
with:
  configure-flags: '--enable-something --enable-other-things'
  release-tag: ${{ github.ref_name }}
  github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Inputs

| Name               | Description                                                                                      | Required | Default   |
|--------------------|--------------------------------------------------------------------------------------------------|----------|-----------|
| `release-tag`      | The tag to use when building the extension; there must be an existing draft release for the tag  | `true`   | -         |
| `create-release`   | Create the release (as a draft) for `release-tag` if it doesn't already exist                    | `false`  | `'false'` |
| `github-token`     | The GitHub token to use. Usually `${{ secrets.GITHUB_TOKEN }}` would be fine for most cases.     | `true`   | -         |
| `configure-flags`  | If you need to pass additional flags to the `./configure` command, specify them here             | `false`  | `''`      |
| `build-path`       | Path to the extension source directory containing `config.m4`, relative to repo root             | `false`  | `'.'`     |
| `upload-artifacts` | Whether to upload the generated `.zip` as a workflow build artifact                              | `false`  | `'false'` |

### Outputs

| Name           | Description                       |
|----------------|-----------------------------------|
| `package-path` | Path to the generated `.zip` file |

## Complete example

This use case is for a scenario where:

 - The action triggers when you push any tag
 - It will build for a matrix of PHP versions, architectures and thread-safety modes,
   creating the draft release the first time it's needed (it's safe for every matrix
   job to do this - only one release is ever created, even if many jobs race to create
   it at the same time)
 - It will then check out your extension, set up the required PHP version, build it, and upload to the draft release

You would then have to navigate to the draft release and publish it.

```yaml
name: Build and release binaries for PIE

on:
  push:
    tags:
      - '*'

permissions:
  contents: read

jobs:
  add-pie-binaries:
    runs-on: ${{ matrix.operating-system }}
    # The matrix defines which combination of binaries you want to build
    strategy:
      matrix:
        operating-system:
          - ubuntu-latest
          - macos-latest
        php-versions:
          - 8.2
          - 8.3
          - 8.4
        zts-mode:
          - ts
          - nts
    permissions:
      # contents:write is required to create the release and upload the release assets
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      # Install the desired version of PHP in order to build the extension for it
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php-versions }}
        env:
          phpts: ${{ matrix.zts-mode }}

      # This invokes the action, which builds the extension, creates the archive with
      # the correct naming, creates the draft release for the tag if it doesn't already
      # exist, and uploads it to the release for the given tag name
      - name: Build and release
        id: php-ext-binary-builder
        uses: php/pie-ext-binary-builder@0.0.2
        with:
          release-tag: ${{ github.ref_name }}
          create-release: 'true'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```
