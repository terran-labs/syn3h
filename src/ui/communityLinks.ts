// Official brand marks reduced to inline paths, so the lobby makes no icon requests.
// https://discord.com/branding (Clyde symbol)
// https://brand.github.com/foundations/logo (GitHub Invertocat White)
// Clyde and Invertocat are trademarks of Discord Inc. and GitHub, Inc. respectively.
const DISCORD_ICON = '<svg viewBox="0 0 64 48" aria-hidden="true" focusable="false"><path d="M40.575 0C39.9562 1.09866 39.4006 2.2352 38.8954 3.397C34.0967 2.67719 29.2096 2.67719 24.3982 3.397C23.9057 2.2352 23.3374 1.09866 22.7186 0C18.2104 0.770324 13.8157 2.12155 9.64839 4.02841C1.38951 16.2652 -0.845688 28.1863 0.265599 39.9432C5.10222 43.517 10.5197 46.2447 16.2909 47.9874C17.5916 46.2447 18.7407 44.3883 19.7257 42.4562C17.8568 41.7616 16.0509 40.8903 14.3208 39.88C14.7755 39.5517 15.2175 39.2107 15.6468 38.8824C25.7873 43.6559 37.5316 43.6559 47.6847 38.8824C48.1141 39.236 48.5561 39.577 49.0107 39.88C47.2806 40.9029 45.4748 41.7616 43.5931 42.4688C44.5781 44.4009 45.7273 46.2573 47.028 48C52.7991 46.2573 58.2167 43.5422 63.0533 39.9684C64.3666 26.3299 60.8055 14.5099 53.6452 4.04104C49.4905 2.13418 45.0959 0.782952 40.5876 0.0252565L40.575 0ZM21.1401 32.7072C18.0209 32.7072 15.4321 29.8785 15.4321 26.3804C15.4321 22.8824 17.9199 20.041 21.1275 20.041C24.3351 20.041 26.886 22.895 26.8354 26.3804C26.7849 29.8658 24.3224 32.7072 21.1401 32.7072ZM42.1788 32.7072C39.047 32.7072 36.4834 29.8785 36.4834 26.3804C36.4834 22.8824 38.9712 20.041 42.1788 20.041C45.3864 20.041 47.9246 22.895 47.8741 26.3804C47.8236 29.8658 45.3611 32.7072 42.1788 32.7072Z"/></svg>'
const GITHUB_ICON = '<svg viewBox="0 0 98 96" aria-hidden="true" focusable="false"><path d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"/></svg>'

const DISCORD_INVITE = 'https://discord.gg/dxTFZRM'

export function communityLinks(discordInvite = DISCORD_INVITE) {
  return [
    { href: 'https://github.com/terran-labs/syn3h', label: 'Mira on GitHub', icon: GITHUB_ICON },
    ...(discordInvite.trim() ? [{ href: discordInvite.trim(), label: 'Join the Mira community on Discord', icon: DISCORD_ICON }] : []),
    { href: 'https://terranlabs.com', label: 'Terran Labs', text: 'terranlabs.com' },
  ]
}

export function communityNav(version: HTMLButtonElement): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'lobby-community'
  nav.setAttribute('aria-label', 'Mira community')
  for (const item of communityLinks()) {
    const link = document.createElement('a')
    link.setAttribute('href', item.href)
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.setAttribute('aria-label', item.label)
    if (item.icon) link.innerHTML = item.icon
    else {
      link.className = 'lobby-community-text'
      link.textContent = item.text ?? ''
    }
    nav.append(link)
  }
  // Keep the same version element so Updates and any extra handlers stay attached.
  nav.firstElementChild?.after(version)
  // Rows for the compact pair (lobby-settings.css): GitHub and the version on top, Discord and
  // terranlabs.com below.
  const [github, , discord, studio] = [...nav.children]
  for (const el of [github, version]) el?.classList.add('lobby-row-top')
  for (const el of [discord, studio]) el?.classList.add('lobby-row-bottom')
  return nav
}
