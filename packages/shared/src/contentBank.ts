import type { Firestore } from 'firebase-admin/firestore';
import { ContentBankItem } from './types';

const COLLECTION = 'contentBank';

/**
 * Luku 6: nostalgia- ja historiapilarit eivät synny uutissyötteestä, vaan
 * vaativat oman, etukäteen rakennetun aihepankin. Poimii pankista vanhimman
 * käyttämättömän (tai pisimpään käyttämättömän) alkion annetulle pilarille.
 */
export async function pickBankItem(
  db: Firestore,
  pillar: 'nostalgia' | 'history'
): Promise<ContentBankItem | null> {
  const snap = await db
    .collection(COLLECTION)
    .where('pillar', '==', pillar)
    .where('used', '==', false)
    .limit(1)
    .get();

  if (!snap.empty) {
    const doc = snap.docs[0];
    return { id: doc.id, ...(doc.data() as Omit<ContentBankItem, 'id'>) };
  }

  // Bank exhausted: recycle the least-recently-used item rather than fail
  // the whole daily run.
  const recycled = await db
    .collection(COLLECTION)
    .where('pillar', '==', pillar)
    .orderBy('lastUsedDate', 'asc')
    .limit(1)
    .get();

  if (recycled.empty) return null;
  const doc = recycled.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<ContentBankItem, 'id'>) };
}

export async function markBankItemUsed(db: Firestore, id: string, date: string): Promise<void> {
  await db.collection(COLLECTION).doc(id).update({ used: true, lastUsedDate: date });
}
