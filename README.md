# windows-clipboard-history.vim

[![license:MIT](https://img.shields.io/github/license/Milly/windows-clipboard-history.vim?style=flat-square)](LICENSE)
[![Vim doc](https://img.shields.io/badge/doc-%3Ah%20windows--clipboard--history-orange?style=flat-square&logo=vim)](doc/windows-clipboard-history.txt)

Windows clipboard history source plugin for ddc.vim and ddu.vim.

## Required

- Windows 10 Version 1809 (October 2018 Update)
- PowerShell 5.0 (Pre-installed)
- [denops.vim](https://github.com/vim-denops/denops.vim)
- Either or both of the following:
  - [ddc.vim](https://github.com/Shougo/ddc.vim)
  - [ddu.vim](https://github.com/Shougo/ddu.vim)

## Windows Settings

1. Open the Start menu and click settings gear (⚙).
2. Select the System tab to proceed.
3. Scroll down on the left pane to select the Clipboard tab in the System menu.
4. Turn on the switch of the Clipboard history.

## Configuration

```vim
" ddc.vim
call ddc#custom#patch_global('sources', ['windows-clipboard-history'])
call ddc#custom#patch_global('sourceOptions', #{
      \ windows-clipboard-history: #{
      \   mark: 'Clip',
      \ }})
call ddc#custom#patch_global('sourceParms', #{
      \ windows-clipboard-history: #{
      \   maxAbbrWidth: 100,
      \ }})

" ddu.vim
call ddu#custom#patch_global('sources', [#{
      \ name: 'windows-clipboard-history',
      \ params: #{prefix: 'Clip:'},
      \}])
```
