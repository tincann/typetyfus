import './styles.css'
import { createStorage } from './core/storage'
import { mountHome } from './ui/screens/home'
import { mountSolo } from './ui/screens/solo'
import { mountHostLobby } from './ui/screens/hostLobby'
import { mountJoin } from './ui/screens/join'

const root = document.querySelector<HTMLDivElement>('#app')!
const storage = createStorage(localStorage)

function home(): void {
  mountHome(root, {
    storage,
    onSolo: (wordCount) => mountSolo(root, { storage, wordCount, onExit: home }),
    onHost: (nick, wordCount) => mountHostLobby(root, {
      nick, wordCount,
      onRace: (room) => { console.log('race starts here', room.state()); home() },
      onExit: home,
    }),
    onJoin: (nick) => mountJoin(root, {
      nick,
      onRace: (room) => { console.log('race starts here', room.state()); home() },
      onExit: home,
    }),
  })
}

home()
