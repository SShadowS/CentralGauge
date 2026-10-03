codeunit 70007 "CGR Session Context"
{
    SingleInstance = true;

    var
        CachedSetup: Record "CGR Setup";
        SetupLoaded: Boolean;

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
        BranchContext: Codeunit "CGR Branch Context";
    begin
        exit(BranchContext.CurrentBranch());
    end;

    procedure SetCurrentBranch(NewBranchCode: Code[10])
    var
        BranchContext: Codeunit "CGR Branch Context";
    begin
        BranchContext.SetCurrentBranch(NewBranchCode);
    end;

    procedure Reset()
    begin
        ClearAll();
    end;
}
