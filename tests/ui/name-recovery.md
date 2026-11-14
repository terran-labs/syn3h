# Names and loading copy recovery

Searched the supplied `/tmp/syn3h-research/legacy` trees, including upstream, fork,
syn3h-client, syn3h-interface, syn3h-player-2020-urp-experiments, both proprietary
trees, cloud, cloud-sockets and www. Searches covered source and text/JSON/Unity
asset/prefab lists for name generation, syllables, bot names and message keys.
No original name vocabulary or humorous loading string list was recovered.

Paths below are relative to that legacy directory.

* `syn3h-client/Assets/_Core/Scripts/Utilities/NameGenerator.cs:5`: empty MonoBehaviour.
  All 15 reachable client commits were available. `git log --all -p -S NameGenerator`
  and the file history show its sole introduction in `7794f90`, already empty.
* `syn3h-client/Assets/_Core/Scripts/CoreConfig.cs:42`: LoadingMessages and
  TeaserMessages declarations. `git log --all -p -S LoadingMessages` finds their
  introduction, not populated content.
* `syn3h-client/Assets/_Core/Resources/_Controller.prefab:377`: both arrays are `[]`.
* `syn3h-client/Assets/_Core/Scripts/CoreLanguage.cs:56`: commented code fetches
  `loading_messages` or `teaser_messages` from the GameSparks `lang_en` property and
  randomly selects a string. No corresponding local property export was found.
* `syn3h-client/Assets/_Core/Scripts/LobbyLoadingProgressText.cs:7`: five-second
  snarky-message interval, requesting `loading_message`. `_Runtime.prefab:10061`
  serializes five seconds; `_Runtime.prefab:6631` references `teaser_message`.
  `git log --all -p -S loading_message` contains this code but no text list.
* `upstream/unity/Assets/Martian Assets/Scripts/Lobby/Lobby.js:121`: downloads
  `http://dat.marsxplr.com/upd3`; line 139 collects `m=` records; line 193 assigns
  the array. There is no baked-in message list. The Unity 5 Compatibility Fix copy
  has the same implementation. The legacy endpoint was not executed or contacted.
* `fork/unity/Assets/Martian Assets/Scripts/Lobby/Lobby.cs:222`: equivalent conversion
  to `msgs.ToArray()`, also fed by downloaded records.
* `upstream/unity/Assets/Martian Assets/Scripts/Game/Game.js:1009`: bots are named
  `GameData.userName + "'s bot"`, appending a number after the first. This is not a
  procedural sci-fi name generator. The compatibility copy has the same expression.

The other supplied trees yielded no relevant vocabulary or message-list content.
These findings establish what is present in the supplied repositories, not what may
have existed in the retired service or in an owner backup.

`src/ui/data/names.ts` and `loadingMessages.ts` contain newly written browser-edition
content, explicitly labeled as new. Nothing in those files is presented as recovered
Syn3h wording. The five-second rotation interval is recovered behavior.
