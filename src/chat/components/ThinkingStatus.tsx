import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.tsx";

const THINKING_VERBS = [
  "is thinking",
  "is analyzing contextual data",
  "is pondering",
  "is exploring possibilities",
  "is synthesizing ideas",
  "is computing paths",
  "is resolving logic",
  "is parsing semantics",
  "is constructing responses",
  "is interpreting intent",
  "is weaving thoughts",
  "is processing inputs",
  "is evaluating constraints",
  "is assembling paradigms",
  "is calibrating tensors",
  "is indexing memories",
  "is extrapolating vectors",
  "is connecting dots",
  "is deciphering queries",
  "is aligning objectives",
  "is routing thoughts",
  "is optimizing heuristic bounds",
  "is unrolling loops",
  "is querying knowledge graphs",
  "is bridging concepts",
  "is formulating strategies",
  "is reviewing context windows",
  "is distilling facts",
  "is structuring syntax",
  "is generating potential worlds",
  "is rendering concepts",
  "is simulating outcomes",
  "is drafting narratives",
  "is tracing execution flows",
  "is projecting scenarios",
  "is expanding context networks",
  "is cross-referencing archives",
  "is mapping algorithms",
  "is building semantic bridges",
  "is decoding symbols",
  "is unwinding recursive thoughts",
  "is fetching relevant insights",
  "is analyzing edge cases",
  "is establishing connections",
  "is evaluating syntax trees",
  "is navigating logical gates",
  "is deducing conclusions",
  "is searching the latent space",
  "is inferring implicit meaning",
  "is mapping dimensions",
  "is assessing probability",
  "is calculating next steps",
  "is traversing conceptual graphs",
  "is examining edge variables",
  "is verifying constraints",
  "is scanning mental databases",
  "is aggregating ideas",
  "is refining logic structures",
  "is projecting logic",
  "is analyzing potential solutions",
  "is calculating vector spaces",
  "is synthesizing paradigms",
  "is reviewing previous statements",
  "is mapping causal links",
  "is deriving corollaries",
  "is simulating dialogue",
  "is mapping logical spaces",
  "is assembling puzzle pieces",
  "is generating possibilities",
  "is weighing alternatives",
  "is constructing arguments",
  "is decoding ambiguity",
  "is inferring patterns",
  "is clustering relevant topics",
  "is exploring latent variables",
  "is extracting semantic cores",
  "is balancing equations",
  "is translating concepts",
  "is modeling realities",
  "is connecting synapses",
  "is activating neural pathways",
  "is fine-tuning outputs",
  "is tracing linguistic roots",
  "is measuring semantic proximity",
  "is formulating plans",
  "is constructing frameworks",
  "is organizing thought streams",
  "is linking references",
  "is analyzing tone",
  "is scanning knowledge bases",
  "is piecing together models",
  "is building cognitive structures",
  "is generating insights",
  "is forecasting responses",
  "is evaluating trade-offs",
  "is mapping inference paths",
  "is predicting user intent",
  "is resolving paradoxes",
  "is unpacking meaning",
  "is tracing references",
];

export function ThinkingStatus() {
  const [verbIndex, setVerbIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_VERBS.length),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setVerbIndex((value) => (value + 1) % THINKING_VERBS.length);
    }, 1500);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <Box marginLeft={1}>
      <Spinner type="star" color="cyan" />
      <Text color="gray">{` ${THINKING_VERBS[verbIndex]}...`}</Text>
    </Box>
  );
}
