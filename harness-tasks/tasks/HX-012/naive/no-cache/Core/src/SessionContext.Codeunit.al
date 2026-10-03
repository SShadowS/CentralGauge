codeunit 70007 "CGR Session Context"
{
    SingleInstance = true;

    var
        BranchCode: Code[10];
        BranchSet: Boolean;

    procedure GetSetup(var Setup: Record "CGR Setup")
    begin
        if not Setup.Get() then
            Setup.Init();
    end;

    procedure RefreshSetup()
    begin
    end;

    procedure CurrentBranch(): Code[10]
    var
        Setup: Record "CGR Setup";
    begin
        if BranchSet then
            exit(BranchCode);
        GetSetup(Setup);
        exit(Setup."Default Branch Code");
    end;

    procedure SetCurrentBranch(NewBranchCode: Code[10])
    begin
        BranchCode := NewBranchCode;
        BranchSet := true;
    end;

    procedure Reset()
    begin
        ClearAll();
    end;
}
