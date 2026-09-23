import type { ContentLibrary } from "@/modules/learning-content/library-tree";
import type { LearningCard, Subject } from "@/modules/learning-content/types";

const subjectNames: Record<Subject, string> = { chinese: "语文", english: "英语" };

function WordList({ cards }: { cards: LearningCard[] }) {
  return (
    <ul className="library-words">
      {cards.map((card) => (
        <li key={card.id}>
          <strong>{card.answerText}</strong>
          {(card.pinyinText || card.hintText) && (
            <span className="library-word-note">
              {[card.pinyinText, card.hintText].filter(Boolean).join(" · ")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function UnplacedWords({ cards }: { cards: LearningCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="library-unplaced">
      <h3>教材未分课 <span>{cards.length} 个词</span></h3>
      <WordList cards={cards} />
    </section>
  );
}

export function ContentLibraryTree({ library }: { library: ContentLibrary }) {
  const hasPersonal = library.personal.chinese.length > 0 || library.personal.english.length > 0;
  return (
    <div className="content-library">
      {library.total === 0 && <p className="library-empty">还没有听写内容</p>}
      {library.editions.length > 0 && (
        <div className="library-editions">
          {library.editions.map((edition) => (
            <details className="library-edition" key={edition.id}>
              <summary>
                <span className="library-title">{subjectNames[edition.subject]} · {edition.grade} 年级{edition.volume} · {edition.label}</span>
                <span className="library-count">{edition.units.length} 个单元 · {edition.count} 个词</span>
              </summary>
              <div className="library-edition-content">
                {edition.units.map((unit) => (
                  <details className="library-unit" key={unit.id}>
                    <summary>
                      <span className="library-title">{unit.title}</span>
                      <span className="library-count">{unit.sections.length} 课 · {unit.count} 个词</span>
                    </summary>
                    <div className="library-unit-content">
                      {unit.sections.map((section) => (
                        <details className="library-section" key={section.id}>
                          <summary>
                            <span className="library-title">{section.title}</span>
                            <span className="library-count">{section.cards.length} 个词</span>
                          </summary>
                          <WordList cards={section.cards} />
                        </details>
                      ))}
                      <UnplacedWords cards={unit.unplaced} />
                    </div>
                  </details>
                ))}
                <UnplacedWords cards={edition.unplaced} />
              </div>
            </details>
          ))}
        </div>
      )}
      {!library.editions.some((edition) => edition.subject === "english") && (
        <p className="library-empty library-english-empty">英语教材词库尚未导入</p>
      )}
      {hasPersonal && (
        <section className="library-personal-group">
          <h2>我的自建内容</h2>
          {(["chinese", "english"] as const).map((subject) => {
            const cards = library.personal[subject];
            return cards.length > 0 ? (
              <details className="library-personal" key={subject}>
                <summary>
                  <span className="library-title">{subjectNames[subject]}</span>
                  <span className="library-count">{cards.length} 个词</span>
                </summary>
                <WordList cards={cards} />
              </details>
            ) : null;
          })}
        </section>
      )}
    </div>
  );
}
