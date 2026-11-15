# 参考对象固定版本与源码索引（2026-10-09）

配套：[可借鉴对象总目录](reference-project-catalog.md) · [提取与结构化总结研究](video-information-extraction-and-summary-2026-10-09.md)。

E1 表示已定位相关实现；E2 表示官方文档或 skill 合同。两者都不是本项目真实运行验收。路径为本轮结论的证据及相邻复查入口，不表示整个文件或仓库经过逐行审计。公开 URL 固定到提交；本机浅克隆/稀疏检出位于忽略提交的 `local-data/research/references-20261009/`，CreatorHub 沿用同级 `creatorhub-037f8b3/`。

本轮审阅第三方 SKILL.md 是研究行为，没有安装或执行这些 skills，也没有执行其中的上传、飞书写入、浏览器安装或真实平台操作。

<a id="r01"></a>
## R01 · duyi2076/duyi-douyin-video-breakdown

- 固定提交：[`fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba`](https://github.com/duyi2076/duyi-douyin-video-breakdown/tree/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba)；提交时间 `2026-08-19T11:21:40+08:00`。
- 证据：E1 源码 + E2 skill 合同。
- 许可证入口：[LICENSE](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/LICENSE)。具体复用须按文件和分发方式复核。
- [scripts/collect_douyin_video.mjs#L196](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/scripts/collect_douyin_video.mjs#L196)
- [scripts/collect_douyin_video.mjs#L394](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/scripts/collect_douyin_video.mjs#L394)
- [scripts/build_report.py#L435](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/scripts/build_report.py#L435)
- [scripts/transcribe_with_doubao.py](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/scripts/transcribe_with_doubao.py)
- [SKILL.md#L90](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/SKILL.md#L90)
- [references/layered-breakdown-v2.md](https://github.com/duyi2076/duyi-douyin-video-breakdown/blob/fb1a6cefd7ad1ea8266863e3d595e7dd282e28ba/references/layered-breakdown-v2.md)

<a id="r02"></a>
## R02 · YT-smart/Ether_vs

- 固定提交：[`733338f9cddc2ac68cfcb877ff8b571e3160752a`](https://github.com/YT-smart/Ether_vs/tree/733338f9cddc2ac68cfcb877ff8b571e3160752a)；提交时间 `2026-07-07T23:02:06+08:00`。
- 证据：E1 源码。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [server.mjs#L244](https://github.com/YT-smart/Ether_vs/blob/733338f9cddc2ac68cfcb877ff8b571e3160752a/server.mjs#L244)
- [tools/parse_video_py_bridge.py](https://github.com/YT-smart/Ether_vs/blob/733338f9cddc2ac68cfcb877ff8b571e3160752a/tools/parse_video_py_bridge.py)
- [tools/asr/transcribe_qwen_worker.py](https://github.com/YT-smart/Ether_vs/blob/733338f9cddc2ac68cfcb877ff8b571e3160752a/tools/asr/transcribe_qwen_worker.py)
- [tools/asr/transcribe_qwen_stream.py#L46](https://github.com/YT-smart/Ether_vs/blob/733338f9cddc2ac68cfcb877ff8b571e3160752a/tools/asr/transcribe_qwen_stream.py#L46)
- [tools/douyin/douyin.js#L331](https://github.com/YT-smart/Ether_vs/blob/733338f9cddc2ac68cfcb877ff8b571e3160752a/tools/douyin/douyin.js#L331)

<a id="r03"></a>
## R03 · YT-smart/video-parse-transcribe

- 固定提交：[`35085f088eed89365ab68cb8cfe01aea02f525ce`](https://github.com/YT-smart/video-parse-transcribe/tree/35085f088eed89365ab68cb8cfe01aea02f525ce)；提交时间 `2026-07-01T10:21:51+08:00`。
- 证据：E1 源码。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [scripts/video_parse_transcribe.py#L114](https://github.com/YT-smart/video-parse-transcribe/blob/35085f088eed89365ab68cb8cfe01aea02f525ce/scripts/video_parse_transcribe.py#L114)
- [scripts/vendor/parse_video_py/parser/base.py#L71](https://github.com/YT-smart/video-parse-transcribe/blob/35085f088eed89365ab68cb8cfe01aea02f525ce/scripts/vendor/parse_video_py/parser/base.py#L71)
- [scripts/vendor/parse_video_py/parser/douyin.py#L16](https://github.com/YT-smart/video-parse-transcribe/blob/35085f088eed89365ab68cb8cfe01aea02f525ce/scripts/vendor/parse_video_py/parser/douyin.py#L16)

<a id="r04"></a>
## R04 · atian-create/xhs-profile-breakdown-skill

- 固定提交：[`bde75b258c55cc06f935faa43d0bb5006ba06a2f`](https://github.com/atian-create/xhs-profile-breakdown-skill/tree/bde75b258c55cc06f935faa43d0bb5006ba06a2f)；提交时间 `2026-06-17T17:33:45+08:00`。
- 证据：E2 skill 合同；无独立采集器。
- 许可证入口：[LICENSE](https://github.com/atian-create/xhs-profile-breakdown-skill/blob/bde75b258c55cc06f935faa43d0bb5006ba06a2f/LICENSE)。具体复用须按文件和分发方式复核。
- [SKILL.md](https://github.com/atian-create/xhs-profile-breakdown-skill/blob/bde75b258c55cc06f935faa43d0bb5006ba06a2f/SKILL.md)

<a id="r05"></a>
## R05 · dragon-hh/ai-boshu-crawler

- 固定提交：[`57ad263c0be8cf234bcadbc5c07dedc72304d182`](https://github.com/dragon-hh/ai-boshu-crawler/tree/57ad263c0be8cf234bcadbc5c07dedc72304d182)；提交时间 `2026-08-11T23:47:29+08:00`。
- 证据：E1 源码 + E2 分析合同。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [download_douyin_latest.py#L875](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/download_douyin_latest.py#L875)
- [platform_metric_collectors.py#L74](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/platform_metric_collectors.py#L74)
- [postprocess_platform_videos.py](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/postprocess_platform_videos.py)
- [postprocess_bili_videos.py#L301](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/postprocess_bili_videos.py#L301)
- [CREATOR_ANALYSIS.md#L17](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/CREATOR_ANALYSIS.md#L17)
- [prepare_creator_analysis.py](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/prepare_creator_analysis.py)
- [render_creator_analysis_report.py](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/render_creator_analysis_report.py)

<a id="r06"></a>
## R06 · yt-dlp/yt-dlp

- 固定提交：[`51bab8a0116f4d8004c315706d809782607d5847`](https://github.com/yt-dlp/yt-dlp/tree/51bab8a0116f4d8004c315706d809782607d5847)；提交时间 `2026-09-27T22:09:13Z`。
- 证据：E1 抖音 extractor 源码。
- 许可证入口：[LICENSE](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/LICENSE)。具体复用须按文件和分发方式复核。
- [yt_dlp/extractor/tiktok.py#L522](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/tiktok.py#L522)
- [yt_dlp/extractor/tiktok.py#L1495](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/tiktok.py#L1495)

<a id="r08"></a>
## R08 · NanmiCoder/MediaCrawler

- 固定提交：[`e9dd17a16338c3915f2335bc609383d316e055f2`](https://github.com/NanmiCoder/MediaCrawler/tree/e9dd17a16338c3915f2335bc609383d316e055f2)；提交时间 `2026-10-09T14:08:17+08:00`。
- 证据：E1 源码；部分文件先由固定 raw 地址读取。
- 许可证入口：[LICENSE](https://github.com/NanmiCoder/MediaCrawler/blob/e9dd17a16338c3915f2335bc609383d316e055f2/LICENSE)。具体复用须按文件和分发方式复核。
- [media_platform/douyin/client.py#L90](https://github.com/NanmiCoder/MediaCrawler/blob/e9dd17a16338c3915f2335bc609383d316e055f2/media_platform/douyin/client.py#L90)
- [media_platform/douyin/client.py#L248](https://github.com/NanmiCoder/MediaCrawler/blob/e9dd17a16338c3915f2335bc609383d316e055f2/media_platform/douyin/client.py#L248)
- [store/douyin/__init__.py#L94](https://github.com/NanmiCoder/MediaCrawler/blob/e9dd17a16338c3915f2335bc609383d316e055f2/store/douyin/__init__.py#L94)
- [store/douyin/__init__.py#L129](https://github.com/NanmiCoder/MediaCrawler/blob/e9dd17a16338c3915f2335bc609383d316e055f2/store/douyin/__init__.py#L129)

<a id="r09"></a>
## R09 · 3441293738/creatorhub

- 固定提交：[`037f8b39387a715ef7ef7a28a22a66770e22fd67`](https://github.com/3441293738/creatorhub/tree/037f8b39387a715ef7ef7a28a22a66770e22fd67)；提交时间 `2026-10-08T14:45:25+08:00`。
- 证据：E1 已有固定快照复核；本轮远端 HEAD 连接失败。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [app/platforms/douyin/extract.py#L19](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/platforms/douyin/extract.py#L19)
- [app/platforms/douyin/extract.py#L80](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/platforms/douyin/extract.py#L80)
- [app/browser/account_hub.py#L147](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/browser/account_hub.py#L147)
- [app/engine/collection.py#L454](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/engine/collection.py#L454)
- [app/platforms/douyin/client.py](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/platforms/douyin/client.py)
- [app/engine/share_downloader.py](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/app/engine/share_downloader.py)
- [requirements.txt](https://github.com/3441293738/creatorhub/blob/037f8b39387a715ef7ef7a28a22a66770e22fd67/requirements.txt)

<a id="r10"></a>
## R10 · Johnserf-Seed/F2

- 固定提交：[`f6be8c0ffba9a127075bbeafe4838716650b6325`](https://github.com/Johnserf-Seed/F2/tree/f6be8c0ffba9a127075bbeafe4838716650b6325)；提交时间 `2026-10-05T20:17:35-07:00`。
- 证据：E1 源码。
- 许可证入口：[LICENSE](https://github.com/Johnserf-Seed/F2/blob/f6be8c0ffba9a127075bbeafe4838716650b6325/LICENSE)。具体复用须按文件和分发方式复核。
- [f2/apps/douyin/api.py#L43](https://github.com/Johnserf-Seed/F2/blob/f6be8c0ffba9a127075bbeafe4838716650b6325/f2/apps/douyin/api.py#L43)
- [f2/apps/douyin/api.py#L127](https://github.com/Johnserf-Seed/F2/blob/f6be8c0ffba9a127075bbeafe4838716650b6325/f2/apps/douyin/api.py#L127)
- [f2/apps/douyin/filter.py#L1420](https://github.com/Johnserf-Seed/F2/blob/f6be8c0ffba9a127075bbeafe4838716650b6325/f2/apps/douyin/filter.py#L1420)
- [f2/apps/douyin/crawler.py](https://github.com/Johnserf-Seed/F2/blob/f6be8c0ffba9a127075bbeafe4838716650b6325/f2/apps/douyin/crawler.py)

<a id="r11"></a>
## R11 · JoeanAmier/TikTokDownloader

- 固定提交：[`473c90ff70c663cfb69310fff2b8d5192f200661`](https://github.com/JoeanAmier/TikTokDownloader/tree/473c90ff70c663cfb69310fff2b8d5192f200661)；提交时间 `2026-09-16T20:44:45+08:00`。
- 证据：E1 源码。
- 许可证入口：[license](https://github.com/JoeanAmier/TikTokDownloader/blob/473c90ff70c663cfb69310fff2b8d5192f200661/license)。具体复用须按文件和分发方式复核。
- [src/interface/detail.py](https://github.com/JoeanAmier/TikTokDownloader/blob/473c90ff70c663cfb69310fff2b8d5192f200661/src/interface/detail.py)
- [src/interface/comment.py#L155](https://github.com/JoeanAmier/TikTokDownloader/blob/473c90ff70c663cfb69310fff2b8d5192f200661/src/interface/comment.py#L155)
- [src/extract/extractor.py#L290](https://github.com/JoeanAmier/TikTokDownloader/blob/473c90ff70c663cfb69310fff2b8d5192f200661/src/extract/extractor.py#L290)

<a id="r12"></a>
## R12 · Evil0ctal/Douyin_TikTok_Download_API

- 固定提交：[`4f0bed8483c35a980315d9c7b3a1d4a1119ad2b2`](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/tree/4f0bed8483c35a980315d9c7b3a1d4a1119ad2b2)；提交时间 `2026-10-01T17:41:58-07:00`。
- 证据：E1 当前重构版本源码。
- 许可证入口：[LICENSE](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/4f0bed8483c35a980315d9c7b3a1d4a1119ad2b2/LICENSE)。具体复用须按文件和分发方式复核。
- [src/dtk/platforms/douyin/adapter.py](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/4f0bed8483c35a980315d9c7b3a1d4a1119ad2b2/src/dtk/platforms/douyin/adapter.py)
- [src/dtk/platforms/douyin/endpoints.py#L74](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/4f0bed8483c35a980315d9c7b3a1d4a1119ad2b2/src/dtk/platforms/douyin/endpoints.py#L74)
- [src/dtk/platforms/douyin/parser.py#L307](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/4f0bed8483c35a980315d9c7b3a1d4a1119ad2b2/src/dtk/platforms/douyin/parser.py#L307)
- [src/dtk/platforms/douyin/parser.py#L492](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/4f0bed8483c35a980315d9c7b3a1d4a1119ad2b2/src/dtk/platforms/douyin/parser.py#L492)

<a id="r13"></a>
## R13 · jiji262/douyin-downloader

- 固定提交：[`9874f413b2c1f8ad6e731b26e3e05f402fc964f8`](https://github.com/jiji262/douyin-downloader/tree/9874f413b2c1f8ad6e731b26e3e05f402fc964f8)；提交时间 `2026-09-22T18:32:39+08:00`。
- 证据：E1 源码。
- 许可证入口：[LICENSE](https://github.com/jiji262/douyin-downloader/blob/9874f413b2c1f8ad6e731b26e3e05f402fc964f8/LICENSE)。具体复用须按文件和分发方式复核。
- [core/api_client.py](https://github.com/jiji262/douyin-downloader/blob/9874f413b2c1f8ad6e731b26e3e05f402fc964f8/core/api_client.py)
- [core/comments_collector.py#L62](https://github.com/jiji262/douyin-downloader/blob/9874f413b2c1f8ad6e731b26e3e05f402fc964f8/core/comments_collector.py#L62)
- [core/downloader_base.py#L850](https://github.com/jiji262/douyin-downloader/blob/9874f413b2c1f8ad6e731b26e3e05f402fc964f8/core/downloader_base.py#L850)
- [core/transcript_manager.py#L192](https://github.com/jiji262/douyin-downloader/blob/9874f413b2c1f8ad6e731b26e3e05f402fc964f8/core/transcript_manager.py#L192)

<a id="r14"></a>
## R14 · Johnserf-Seed/TikTokDownload

- 固定提交：[`64acbfda8621563da97ed06f133330c3335b1e8d`](https://github.com/Johnserf-Seed/TikTokDownload/tree/64acbfda8621563da97ed06f133330c3335b1e8d)；提交时间 `2024-06-28T18:53:42+08:00`。
- 证据：E2 当前 README + 9 月历史源码审计。
- 许可证入口：[LICENSE](https://github.com/Johnserf-Seed/TikTokDownload/blob/64acbfda8621563da97ed06f133330c3335b1e8d/LICENSE)。具体复用须按文件和分发方式复核。
- [README.md#L75](https://github.com/Johnserf-Seed/TikTokDownload/blob/64acbfda8621563da97ed06f133330c3335b1e8d/README.md#L75)

<a id="r15"></a>
## R15 · JoeanAmier/XHS-Downloader

- 固定提交：[`3261312721f0b37c705ba6515885bc7f34349f2f`](https://github.com/JoeanAmier/XHS-Downloader/tree/3261312721f0b37c705ba6515885bc7f34349f2f)；提交时间 `2026-09-16T20:54:06+08:00`。
- 证据：E1 源码。
- 许可证入口：[LICENSE](https://github.com/JoeanAmier/XHS-Downloader/blob/3261312721f0b37c705ba6515885bc7f34349f2f/LICENSE)。具体复用须按文件和分发方式复核。
- [source/expansion/converter.py](https://github.com/JoeanAmier/XHS-Downloader/blob/3261312721f0b37c705ba6515885bc7f34349f2f/source/expansion/converter.py)
- [source/application/explore.py#L25](https://github.com/JoeanAmier/XHS-Downloader/blob/3261312721f0b37c705ba6515885bc7f34349f2f/source/application/explore.py#L25)

<a id="r16"></a>
## R16 · douyin-comments

- 固定提交：[`57ad263c0be8cf234bcadbc5c07dedc72304d182`](https://github.com/dragon-hh/ai-boshu-crawler/tree/57ad263c0be8cf234bcadbc5c07dedc72304d182)；提交时间 `2026-08-11T23:47:29+08:00`。
- 证据：E1 评论源码 + E2 skill 合同。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [.agents/skills/douyin-comments/SKILL.md](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/douyin-comments/SKILL.md)
- [.agents/skills/douyin-comments/scripts/fetch_douyin_comments_cdp.mjs#L490](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/douyin-comments/scripts/fetch_douyin_comments_cdp.mjs#L490)
- [.agents/skills/douyin-comments/scripts/fetch_douyin_comments.py](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/douyin-comments/scripts/fetch_douyin_comments.py)

<a id="r17"></a>
## R17 · douyin-download

- 固定提交：[`57ad263c0be8cf234bcadbc5c07dedc72304d182`](https://github.com/dragon-hh/ai-boshu-crawler/tree/57ad263c0be8cf234bcadbc5c07dedc72304d182)；提交时间 `2026-08-11T23:47:29+08:00`。
- 证据：E2 skill 合同；配套实现入口供复查。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [.agents/skills/douyin-download/SKILL.md](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/douyin-download/SKILL.md)
- [.agents/skills/douyin-download/scripts/dy_yt.py](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/douyin-download/scripts/dy_yt.py)

<a id="r18"></a>
## R18 · eze-is/web-access

- 固定提交：[`33eef84a55b1919396a80e7a55650a07bb83f590`](https://github.com/eze-is/web-access/tree/33eef84a55b1919396a80e7a55650a07bb83f590)；提交时间 `2026-08-19T09:36:33+08:00`。
- 证据：E1 CDP 执行入口 + E2 文档。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [README.md#L34](https://github.com/eze-is/web-access/blob/33eef84a55b1919396a80e7a55650a07bb83f590/README.md#L34)
- [scripts/cdp-proxy.mjs#L285](https://github.com/eze-is/web-access/blob/33eef84a55b1919396a80e7a55650a07bb83f590/scripts/cdp-proxy.mjs#L285)

<a id="r19"></a>
## R19 · jackwener/opencli

- 固定提交：[`24136945847afbfad266c6c46a8cd335377f9112`](https://github.com/jackwener/opencli/tree/24136945847afbfad266c6c46a8cd335377f9112)；提交时间 `2026-09-25T02:55:12+08:00`。
- 证据：E2 官方机制与适配器文档。
- 许可证入口：[LICENSE](https://github.com/jackwener/opencli/blob/24136945847afbfad266c6c46a8cd335377f9112/LICENSE)。具体复用须按文件和分发方式复核。
- [docs/guide/browser-bridge.md#L71](https://github.com/jackwener/opencli/blob/24136945847afbfad266c6c46a8cd335377f9112/docs/guide/browser-bridge.md#L71)
- [docs/adapters/browser/douyin.md](https://github.com/jackwener/opencli/blob/24136945847afbfad266c6c46a8cd335377f9112/docs/adapters/browser/douyin.md)

<a id="r20"></a>
## R20 · OpenCLI Browser Bridge

- 固定提交：[`24136945847afbfad266c6c46a8cd335377f9112`](https://github.com/jackwener/opencli/tree/24136945847afbfad266c6c46a8cd335377f9112)；提交时间 `2026-09-25T02:55:12+08:00`。
- 证据：E2 官方组件文档。
- 许可证入口：[LICENSE](https://github.com/jackwener/opencli/blob/24136945847afbfad266c6c46a8cd335377f9112/LICENSE)。具体复用须按文件和分发方式复核。
- [docs/guide/browser-bridge.md](https://github.com/jackwener/opencli/blob/24136945847afbfad266c6c46a8cd335377f9112/docs/guide/browser-bridge.md)

<a id="r21"></a>
## R21 · wujunwei928/parse-video-py

- 固定提交：[`5fcf87256edb5ffcdebf0e4aac2a5a41745da76e`](https://github.com/wujunwei928/parse-video-py/tree/5fcf87256edb5ffcdebf0e4aac2a5a41745da76e)；提交时间 `2026-08-19T22:41:38+08:00`。
- 证据：E1 parser/输出模型；与 R02/R03 vendored 版本分开。
- 许可证入口：[LICENSE](https://github.com/wujunwei928/parse-video-py/blob/5fcf87256edb5ffcdebf0e4aac2a5a41745da76e/LICENSE)。具体复用须按文件和分发方式复核。
- [src/parse_video_py/parser/douyin.py](https://github.com/wujunwei928/parse-video-py/blob/5fcf87256edb5ffcdebf0e4aac2a5a41745da76e/src/parse_video_py/parser/douyin.py)
- [src/parse_video_py/parser/base.py](https://github.com/wujunwei928/parse-video-py/blob/5fcf87256edb5ffcdebf0e4aac2a5a41745da76e/src/parse_video_py/parser/base.py)
- [src/parse_video_py/parser/redbook.py](https://github.com/wujunwei928/parse-video-py/blob/5fcf87256edb5ffcdebf0e4aac2a5a41745da76e/src/parse_video_py/parser/redbook.py)

<a id="r24"></a>
## R24 · openai/whisper

- 固定提交：[`86098128c0b4f24f0e2aa2994de830614b474227`](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227)；提交时间 `2026-08-31T10:19:19-07:00`。
- 证据：E2 官方 README；不声称本次完成模型实测。
- 许可证入口：[LICENSE](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/LICENSE)。具体复用须按文件和分发方式复核。
- [README.md](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/README.md)

<a id="r25"></a>
## R25 · SYSTRAN/faster-whisper

- 固定提交：[`9fa78645d7913ff9d94d0907a2156526b19b4556`](https://github.com/SYSTRAN/faster-whisper/tree/9fa78645d7913ff9d94d0907a2156526b19b4556)；提交时间 `2026-10-06T21:10:47+01:00`。
- 证据：E2 官方 README。
- 许可证入口：[LICENSE](https://github.com/SYSTRAN/faster-whisper/blob/9fa78645d7913ff9d94d0907a2156526b19b4556/LICENSE)。具体复用须按文件和分发方式复核。
- [README.md](https://github.com/SYSTRAN/faster-whisper/blob/9fa78645d7913ff9d94d0907a2156526b19b4556/README.md)

<a id="r26"></a>
## R26 · ggml-org/whisper.cpp

- 固定提交：[`d1be6fde11ac6e0407606b4e42fe72d34add8037`](https://github.com/ggml-org/whisper.cpp/tree/d1be6fde11ac6e0407606b4e42fe72d34add8037)；提交时间 `2026-10-06T16:10:35+02:00`。
- 证据：E2 官方 README。
- 许可证入口：[LICENSE](https://github.com/ggml-org/whisper.cpp/blob/d1be6fde11ac6e0407606b4e42fe72d34add8037/LICENSE)。具体复用须按文件和分发方式复核。
- [README.md](https://github.com/ggml-org/whisper.cpp/blob/d1be6fde11ac6e0407606b4e42fe72d34add8037/README.md)

<a id="r27"></a>
## R27 · QwenLM/Qwen3-ASR

- 固定提交：[`7c6daf77a2421100f5fb066495372c00129d39ff`](https://github.com/QwenLM/Qwen3-ASR/tree/7c6daf77a2421100f5fb066495372c00129d39ff)；提交时间 `2026-06-26T16:20:17+08:00`。
- 证据：E2 官方 README；R02 的调用实现另见 R02。
- 许可证入口：[LICENSE](https://github.com/QwenLM/Qwen3-ASR/blob/7c6daf77a2421100f5fb066495372c00129d39ff/LICENSE)。具体复用须按文件和分发方式复核。
- [README.md](https://github.com/QwenLM/Qwen3-ASR/blob/7c6daf77a2421100f5fb066495372c00129d39ff/README.md)

<a id="r28"></a>
## R28 · PaddlePaddle/PaddleOCR

- 固定提交：[`dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf`](https://github.com/PaddlePaddle/PaddleOCR/tree/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf)；提交时间 `2026-09-16T11:30:53+08:00`。
- 证据：E2 官方 README。
- 许可证入口：[LICENSE](https://github.com/PaddlePaddle/PaddleOCR/blob/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf/LICENSE)。具体复用须按文件和分发方式复核。
- [README.md](https://github.com/PaddlePaddle/PaddleOCR/blob/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf/README.md)

<a id="r29"></a>
## R29 · GAIR-NLP/factool

- 固定提交：[`3f3914bc090b644be044b7e0005113c135d8b20f`](https://github.com/GAIR-NLP/factool/tree/3f3914bc090b644be044b7e0005113c135d8b20f)；提交时间 `2024-08-20T04:27:12+08:00`。
- 证据：E1 pipeline 结果结构 + E2 README。
- 许可证入口：[LICENSE](https://github.com/GAIR-NLP/factool/blob/3f3914bc090b644be044b7e0005113c135d8b20f/LICENSE)。具体复用须按文件和分发方式复核。
- [README.md](https://github.com/GAIR-NLP/factool/blob/3f3914bc090b644be044b7e0005113c135d8b20f/README.md)
- [factool/factool.py#L98](https://github.com/GAIR-NLP/factool/blob/3f3914bc090b644be044b7e0005113c135d8b20f/factool/factool.py#L98)

<a id="r30"></a>
## R30 · shmsw25/FActScore

- 固定提交：[`f28272deffcf33efc1f1117d5479c10bb75221a9`](https://github.com/shmsw25/FActScore/tree/f28272deffcf33efc1f1117d5479c10bb75221a9)；提交时间 `2025-04-13T16:41:02-04:00`。
- 证据：E1 原子事实/检索评分入口 + E2 README。
- 许可证入口：[LICENSE](https://github.com/shmsw25/FActScore/blob/f28272deffcf33efc1f1117d5479c10bb75221a9/LICENSE)。具体复用须按文件和分发方式复核。
- [README.md](https://github.com/shmsw25/FActScore/blob/f28272deffcf33efc1f1117d5479c10bb75221a9/README.md)
- [factscore/factscorer.py#L108](https://github.com/shmsw25/FActScore/blob/f28272deffcf33efc1f1117d5479c10bb75221a9/factscore/factscorer.py#L108)

<a id="r31"></a>
## R31 · MichSchli/AVeriTeC

- 固定提交：[`7c62d1ec8df3fb560d6efe2b85fa191135636f81`](https://github.com/MichSchli/AVeriTeC/tree/7c62d1ec8df3fb560d6efe2b85fa191135636f81)；提交时间 `2024-11-27T15:15:59Z`。
- 证据：E2 官方数据结构与基线说明。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [README.md](https://github.com/MichSchli/AVeriTeC/blob/7c62d1ec8df3fb560d6efe2b85fa191135636f81/README.md)

<a id="n01-n04"></a>
## N01-N04 · 新增发现的四个分析子 skills

- 固定提交：[`57ad263c0be8cf234bcadbc5c07dedc72304d182`](https://github.com/dragon-hh/ai-boshu-crawler/tree/57ad263c0be8cf234bcadbc5c07dedc72304d182)；提交时间 `2026-08-11T23:47:29+08:00`。
- 证据：E2 子 skill 与分析合同；不是本轮执行的 skills。
- 本次未发现根目录 LICENSE/COPYING 文件；不能据此推断允许复制。仓库内其它位置及数据许可另行核对。
- [.agents/skills/video-transcript-doc-writer/SKILL.md](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/video-transcript-doc-writer/SKILL.md)
- [.agents/skills/creator-daily-analysis/SKILL.md](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/creator-daily-analysis/SKILL.md)
- [.agents/skills/creator-three-day-analysis/SKILL.md](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/creator-three-day-analysis/SKILL.md)
- [.agents/skills/creator-weekly-analysis/SKILL.md](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/.agents/skills/creator-weekly-analysis/SKILL.md)
- [CREATOR_ANALYSIS.md](https://github.com/dragon-hh/ai-boshu-crawler/blob/57ad263c0be8cf234bcadbc5c07dedc72304d182/CREATOR_ANALYSIS.md)

<a id="r07"></a>
## R07 · df 对标拆解助手 1.5.3

- 本机 manifest 确认 `name=df对标拆解助手`、`version=1.5.3`。未确认公开源码仓库或开源许可证。
- 只读检查目录：`D:\BaiduNetdiskDownload\对标拆解插件\dcxzs_extension_protected`。未运行插件或外部服务。
- 9 月功能/分页审查：[历史三方对比](../handoff/archive/2026-09/signal-desk-following-sync-redesign-handoff-2026-09-24.md)。本轮重新核对 manifest、接口字面量与以下文件哈希；不把混淆前端等同于服务端实现。

| 文件 | SHA-256 |
|---|---|
| `manifest.json` | `78e6de3197a3ba1cbbcde0efcaef1a69a40626cff1afe5c4c19c3ff802e71f71` |
| `inject.js` | `f9e8c78475e2c3e156045124313e580939fcde3d113c9166448a999a0d92bb92` |
| `modules/dy_comment_module.js` | `1873821be44775cbcc397838ee891eac42672a1af0bc3dd62e8b6c9f856aeb38` |
| `background.js` | `20ae689ebed53a43f30ac863a4a25fd38cc3517783e6f053da15218d82f3754a` |

<a id="r22"></a>
## R22 · FFmpeg

- E2：[官方 FFmpeg 文档](https://ffmpeg.org/ffmpeg.html)，2026-10-09 读取；网页非固定 Git 提交。
- 本次 HTML 快照 SHA-256：`e04c69cd08537b9b9d8d16ecaab9f56d938455e54ef42c37a2019053df8495cb`。

<a id="r23"></a>
## R23 · FFprobe

- E2：[官方 FFprobe 文档](https://ffmpeg.org/ffprobe.html)，2026-10-09 读取；关注媒体流、格式、JSON 输出。
- 本次 HTML 快照 SHA-256：`75dd3d482461e4b453510ec9fc87076a95f2eb0698d211784e1eabaabc82eeb6`。
- FFmpeg/FFprobe 的授权取决于具体构建与启用组件，不能仅凭命令名称决定分发方式。

<a id="r32"></a>
## R32 · 未命名 Cloudreve 分享材料

只确认 2026-08-27 项目会话提到分享材料；未识别文件、产品、源码或许可证。不复述可能带访问令牌的链接，不作实现结论。

## 历史引用来源

- [2026-08-30 交接中的四个 skills 审计](../handoff/archive/signal-desk-2026-08-30.md)。
- [2026-09-05 社区路线研究](signal-desk-community-validated-routes-2026-09-05.md)。
- [2026-09-24 df/ai-boshu 三方审查](../handoff/archive/2026-09/signal-desk-following-sync-redesign-handoff-2026-09-24.md)。
- [2026-10-09 CreatorHub 共识](creatorhub-consensus-2026-10-09.md)及其关联研究。
- 2026-08-27 首次多个参考链接的本项目会话记录：`rollout-2026-08-27T20-39-34-01a0433b-9945-7762-b0d3-fd71f8061879.jsonl` 第 22 行。Ether_vs 在此出现；本轮未把私人会话全文复制进仓库。

## 版本变化与未知事项

- `ai-boshu-crawler`、duyi、video-parse-transcribe 和 xhs-profile 的固定提交与 8/9 月旧研究相同；本次补查到的功能不能自动称为近期新增。
- Download API 本次使用 `src/dtk/` 的当前结构；旧 `crawlers/douyin/web/` 链接在本次提交返回 404，已按 Git tree 定位新路径。
- CreatorHub 的本轮 `git ls-remote HEAD` 因网络连接失败，复核对象仍是已保留的 `037f8b3…`，不保证为本轮远端最新提交。
- 无真实平台运行、模型评测或百账号负载验证；未找到或未验证的功能在专题中保留限定语。
