codeunit 70007 "CGR Session Context"
{
    SingleInstance = true;

    var
        CachedSetup: Record "CGR Setup";
        SetupLoaded: Boolean;
        BranchCode: Code[10];
        BranchSet: Boolean;

    procedure GetSetup(var Setup: Record "CGR Setup")
    begin
        if not SetupLoaded then begin
            if not CachedSetup.Get() then
                CachedSetup.Init();
            SetupLoaded := true;
        end;
        Setup := CachedSetup;
    end;

    procedure RefreshSetup()
    begin
        SetupLoaded := false;
        Clear(CachedSetup);
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
    var
        BranchContext: Codeunit "CGR Branch Context";
    begin
        ClearAll();
        BranchContext.ClearCurrentBranch();
    end;
}
