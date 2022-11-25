function! windows_clipboard_history#ddc#_insert(lnum, lines, curpos) abort
  try
    call s:insert(a:lnum, a:lines, a:curpos)
  catch /^Vim.*:E565:/
    call s:feed_insert(a:lnum, a:lines, a:curpos)
  endtry
endfunction

function! s:insert(lnum, lines, curpos) abort
  call setline(a:lnum, a:lines[0])
  if len(a:lines) > 1
    call append(a:lnum, a:lines[1:])
  endif
  call setpos('.', a:curpos)
endfunction

function! s:feed_insert(lnum, lines, curpos) abort
  let s:insert_data = {
  \ 'lnum': a:lnum,
  \ 'lines': a:lines,
  \ 'curpos': a:curpos,
  \}
  call feedkeys("\<Cmd>call windows_clipboard_history#ddc#_apply_insert()\<CR>" .. v:char, 'in')
  call feedkeys("\<Ignore>", 'n')
  let v:char = ''
endfunction

function! windows_clipboard_history#ddc#_apply_insert() abort
  let s = get(s:, 'insert_data', {})
  if !empty(s)
    call s:insert(s.lnum, s.lines, s.curpos)
    unlet s:insert_data
  endif
endfunction

function! windows_clipboard_history#_setcmdline(str, pos) abort
  if exists('*setcmdline')
    return setcmdline(a:str, a:pos)
  endif
  let str = substitute(escape(a:str, '"\'), '[[:cntrl:]]', "\<C-V>\\0", 'g')
  let keys = printf("\<C-\>e[\"%s\",setcmdpos(%d)][0]\<CR>", str, a:pos)
  return feedkeys(keys, 'in')
endfunction
