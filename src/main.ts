import './styles.css'
import { createStorage } from './core/storage'
import { mountHome } from './ui/screens/home'
import { mountSolo } from './ui/screens/solo'

const root = document.querySelector<HTMLDivElement>('#app')!
const storage = createStorage(localStorage)

function home(): void {
  mountHome(root, {
    storage,
    onSolo: (wordCount) => mountSolo(root, { storage, wordCount, onExit: home }),
    onHost: () => alert('Rooms arrive in a later task.'),
    onJoin: () => alert('Rooms arrive in a later task.'),
  })
}

home()
