/**
 * Common given names, lowercase, used by Incognito to catch names written without a cue ("ask Rohit").
 * Broad on purpose: Indian, English-speaking, European, East and South-East Asian, Middle Eastern and African names.
 */
const NAMES = `
aarav aarti aarush aditi aditya advait agastya ahaan ajay akash akhil akshay alok aman amar amit amita amol anand ananya anil anika anirudh anita anjali ankit ankita anmol anoop anshul anu anuj anupam anurag anushka apoorva aravind archana arjun arnav arpit arun aruna arvind aryan asha ashish ashok ashwin atul ayaan ayush
bhavna bharat bhavesh chaitanya chandan chetan chirag deepa deepak deepika dev devansh dhruv dinesh divya gaurav gautam geeta girish gopal govind harsh harsha hemant himanshu hitesh indira isha ishaan ishita jaya jayesh jyoti kabir kajal kalpana kamal karan kartik kavita kavya keshav kiran kishore krishna kunal lakshmi lalit madhav madhu mahesh manish manoj meena meera mehul mohan mohit mukesh nandini naveen neeraj neha nikhil nikita nilesh nisha nitin ojas pallavi pankaj parth pooja pradeep prakash pranav prashant pratik praveen preeti prem priya priyanka puja rachna radha raghav rahul raj rajat rajesh rajiv rakesh ramesh rani ravi reena rekha ritika rohan rohit ruchi sachin sagar sahil sakshi samir sandeep sanjay sanjana santosh sarita saurabh shalini shankar shikha shivam shreya shruti siddharth simran sneha sonal sonia sudha sumit sunil sunita suraj suresh swati tanvi tanya tarun tejas uday uma usha varun vasudha ved vidya vijay vikas vikram vinay vineet vinod vipin vishal vivek yash yogesh zara zoya
abdul aisha ali amina amir anwar asif ayesha bilal faisal farah farhan fatima hamza hasan hussain imran irfan javed junaid kareem khalid layla mariam mohammed muhammad mustafa nadia nasir omar rashid rehan rizwan saad salman sameer sana shahid sharif tariq usman yasmin yusuf zain zainab ahmed ahmad mahmoud karim leila noor rania samira youssef hassan
aaron abigail adam adrian aidan alan albert alex alexander alexandra alice alicia allison amanda amber amelia amy andrea andrew angela anna anne anthony antonio arthur ashley audrey austin barbara ben benjamin beth betty brandon brenda brian brittany bruce caleb cameron carl carlos carol caroline carter catherine charles charlie charlotte chloe chris christian christina christine christopher claire clara colin connor craig cynthia daniel danielle david deborah debra denise dennis derek diana diane donald donna dorothy douglas dylan edward eleanor elena elijah elizabeth ella ellen emily emma eric erica erin ethan eugene evan evelyn frank gabriel gary george gloria grace gregory hannah harold harry heather helen henry holly ian isaac isabella jack jacob jacqueline james jamie jane janet janice jason jeffrey jennifer jeremy jerry jessica joan joe john jonathan jordan jose joseph joshua joyce juan judith julia julie justin karen katherine kathleen kathryn katie keith kelly kenneth kevin kimberly kyle larry laura lauren lawrence leah liam lily linda lisa logan louis lucas lucy luke madison margaret maria marie marilyn martha martin mary mason matthew megan melissa michael michelle mike nancy natalie nathan nicholas nicole noah oliver olivia pamela patricia patrick paul peter philip rachel ralph raymond rebecca richard robert roger ronald ruth ryan samantha samuel sandra sarah scott sean sharon shirley sophia sophie stephanie stephen steve steven susan teresa theresa thomas timothy tom tyler victoria vincent walter wayne william zachary zoe
alessandro andrea francesca giulia giuseppe lorenzo luca marco matteo paolo sofia hans jurgen klaus lukas stefan wolfgang anja katrin pierre jacques jean louise camille antoine francois mathieu nicolas sebastien amelie juan pablo javier miguel alejandro diego sergio lucia carmen pilar ines joao pedro rafael thiago beatriz mariana ivan dmitri sergei olga natasha svetlana tatiana anastasia nikolai igor boris pavel katarzyna piotr tomasz agnieszka magdalena erik lars magnus nils sven ingrid astrid freya
wei li ming hui jun xin yan lei fang jing hong ying yu chen liang hao jie mei ling hiroshi takashi kenji yuki haruto sakura yui aiko akira daichi ren sota minjun seojun jiwoo seoyeon jisoo minji hyun sung nguyen thanh minh anh linh huong tuan duc siti nur putri dewi budi agus
adebayo chidi chinedu emeka ngozi oluwaseun tunde yemi kwame kofi ama abena akua thabo sipho themba zanele lerato tendai tafadzwa amani baraka jabari zuri wanjiru njeri otieno achieng
`;

/** Given names that are also everyday English words: only treated as names when written with a capital letter. */
const AMBIGUOUS = `
will mark rose may june april august grace hope joy faith bill sunny amber dawn eve iris ivy jade jasmine lily daisy holly ruby pearl
bob drew frank gene jack jean ken kim lee max pat ray rob sam sue ted tom
victor ali dev raj ved uma ren sung li ming yu chen hong jun lei fang wei mei amir noor sana zara ella anna ava jay ash
prem raja rani asha sagar kiran jaya roshan christian carter mason austin logan jordan cameron hunter dylan evan ian luke paul
peter neil dean earl miles norman parker penny sandy shelby wade
harsh ama kamal mohan uday chandan gopal hasan
`;

export const GIVEN_NAMES: ReadonlySet<string> = new Set(NAMES.split(/\s+/).filter(Boolean));
export const AMBIGUOUS_NAMES: ReadonlySet<string> = new Set(AMBIGUOUS.split(/\s+/).filter(Boolean));

/** Capitalised words that are common at the start of clauses or in everyday text: never a name in strict mode. */
const COMMON_CAPITALISED = `
i i'm i've i'll i'd a an the this that these those it its is are was were be been am do does did have has had can could should would will shall may might must
and or but so if then because when where what which who whom whose why how yes no not ok okay hi hello hey dear thanks thank please sorry
my your our their his her we you they he she me us them mine yours ours
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december
mr mrs ms miss dr prof sir madam
english hindi india indian usa uk us europe european american british
also just only even still yet maybe perhaps however therefore actually really very much more most less least first second third last next
there here now today tomorrow yesterday after before during while since until about above below between into onto over under again
all any both each few many some such no nor own same other another every one two three four five six seven eight nine ten
what's it's that's there's here's let's don't doesn't didn't can't won't isn't aren't wasn't weren't
note update question answer summary clause section page lease rent deposit agreement tenant landlord contract notice terms
`;
export const COMMON_WORDS: ReadonlySet<string> = new Set(COMMON_CAPITALISED.split(/\s+/).filter(Boolean));
