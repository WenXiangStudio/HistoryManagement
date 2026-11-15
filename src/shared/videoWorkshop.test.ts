import {expect,it} from 'vitest'
import {parseDouyinWorkshopLink} from './videoWorkshop'

it('keeps an empty entry idle and normalizes a full video URL without tracking parameters',()=>{
  expect(parseDouyinWorkshopLink('  \n ')).toEqual({state:'empty'})
  expect(parseDouyinWorkshopLink('https://douyin.com/video/7123456789012345678/?from=share#detail')).toEqual({state:'valid',kind:'video',canonicalUrl:'https://www.douyin.com/video/7123456789012345678',workId:'7123456789012345678'})
})

it('extracts a short link from copied share text without guessing its video identity',()=>{
  expect(parseDouyinWorkshopLink('4.21 复制打开抖音，看看这个作品 https://v.douyin.com/aBc_123-/。')).toEqual({state:'valid',kind:'short',canonicalUrl:'https://v.douyin.com/aBc_123-/',workId:null})
  expect(parseDouyinWorkshopLink('分享（https://www.douyin.com/video/7123456789012345678）')).toMatchObject({state:'valid',kind:'video'})
})

it.each([
  'https://www.douyin.com.evil.example/video/7123456789012345678',
  'https://evil.douyin.com/video/7123456789012345678',
  'https://www.douyin.com@evil.example/video/7123456789012345678',
  'https://user@www.douyin.com/video/7123456789012345678',
  'https://www.douyin.com:8000/video/7123456789012345678',
  'https://example.com/?redirect=https://www.douyin.com/video/7123456789012345678',
  'http://www.douyin.com/video/7123456789012345678',
  'https://www.douyin.com/user/author-sec',
  'https://www.douyin.com/collection/123',
  'https://v.douyin.com/token/extra',
  'https://www.douyin.com/video/not-a-number',
  'https://www.douyin.com/video/7123456789012345678 https://v.douyin.com/other/',
  '不是链接'
])('rejects an unsupported or ambiguous input without producing a download URL: %s',(input)=>{
  const result=parseDouyinWorkshopLink(input)
  expect(result.state).toBe('invalid')
  expect(result).not.toHaveProperty('canonicalUrl')
})
