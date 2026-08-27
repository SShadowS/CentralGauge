codeunit 70091 "CG M044 Priority Calc"
{
    Access = Public;

    procedure NextPriority(IsEmptyView: Boolean; BelowxRec: Boolean; xRecPriority: Code[20]; LastInGroupPriority: Code[20]) Result: Code[20]
    begin
        if IsEmptyView then
            exit('1');

        if BelowxRec then
            exit(IncStr(xRecPriority));

        exit(IncStr(LastInGroupPriority));
    end;
}
