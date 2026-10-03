codeunit 70013 "CGR Branch Context"
{
    SingleInstance = true;

    var
        BranchCode: Code[10];
        BranchSet: Boolean;

    procedure CurrentBranch(): Code[10]
    var
        Setup: Record "CGR Setup";
    begin
        if BranchSet then
            exit(BranchCode);
        if not Setup.Get() then
            Setup.Init();
        exit(Setup."Default Branch Code");
    end;

    procedure SetCurrentBranch(NewBranchCode: Code[10])
    begin
        BranchCode := NewBranchCode;
        BranchSet := true;
    end;

    internal procedure ClearCurrentBranch()
    begin
        ClearAll();
    end;
}
