codeunit 70205 "CG Priority Calculator"
{
    Access = Public;

    procedure GetPriorityScore(Priority: Enum "CG Priority Level"): Integer
    begin
        exit(Priority.AsInteger());
    end;

    procedure GetNextHigherPriority(Priority: Enum "CG Priority Level"): Enum "CG Priority Level"
    begin
        case Priority of
            Priority::None:
                exit(Priority::Low);
            Priority::Low:
                exit(Priority::Medium);
            Priority::Medium:
                exit(Priority::High);
            Priority::High:
                exit(Priority::Critical);
            Priority::Critical:
                exit(Priority::Critical);
        end;
    end;

    procedure ComparePriorities(A: Enum "CG Priority Level"; B: Enum "CG Priority Level"): Integer
    begin
        if A.AsInteger() < B.AsInteger() then
            exit(-1);
        if A.AsInteger() > B.AsInteger() then
            exit(1);
        exit(0);
    end;
}
