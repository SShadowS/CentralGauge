codeunit 70013 "CGR Branch Context"
{
    SingleInstance = true;

    var
        BranchCode: Code[10];
        BranchSet: Boolean;

    procedure CurrentBranch(): Code[10]
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        if BranchSet then
            exit(BranchCode);
        SessionContext.GetSetup(Setup);
        exit(Setup."Default Branch Code");
    end;

    procedure SetCurrentBranch(NewBranchCode: Code[10])
    begin
        BranchCode := NewBranchCode;
        BranchSet := true;
    end;
}
