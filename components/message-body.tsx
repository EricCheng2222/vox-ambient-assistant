import { answerBlocks, withAmounts } from "@/lib/answer-layout";

/** Amounts of money in a line, made to stand out a little so prices can be compared at a glance. */
function Line({ text }: { text: string }) {
  return (
    <>
      {withAmounts(text).map((run, index) =>
        run.amount ? (
          <span key={index} className="answer-amount">
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

/**
 * A reply, laid out for reading: paragraphs, and lists of options or steps
 * with the name of each thing first (see lib/answer-layout.ts).
 */
export function MessageBody({ text, onChoose }: { text: string; /** The user tapped a choice: say it for them. */ onChoose?: (said: string) => void }) {
  const blocks = answerBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <div className="message-copy answer-body">
      {blocks.map((block, index) => {
        if (block.kind === "text") {
          return (
            <p key={index}>
              <Line text={block.text} />
            </p>
          );
        }
        if (block.kind === "choices") {
          // Without a way to act on them they are still worth reading, as plain lines.
          return (
            <div key={index} className="answer-choices" role="group" aria-label="What you can do">
              {block.choices.map((choice, choiceIndex) =>
                onChoose ? (
                  <button key={choiceIndex} type="button" onClick={() => onChoose(choice)}>
                    {choice}
                  </button>
                ) : (
                  <span key={choiceIndex}>{choice}</span>
                ),
              )}
            </div>
          );
        }
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} className="answer-list" data-named={block.items.some((item) => item.lead) ? "" : undefined}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                {item.lead ? <span className="answer-lead">{item.lead}</span> : null}
                <span className="answer-detail">
                  <Line text={item.detail} />
                </span>
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
