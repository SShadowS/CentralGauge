codeunit 70681 "CG X108 Feature Gate"
{
    SingleInstance = true;

    var
        Checked: Boolean;
        IsActive: Boolean;

    procedure IsFeatureActive(): Boolean
    var
        ModuleReg: Record "CG X108 Module Registration";
        AllEntitled: Boolean;
    begin
        if Checked then
            exit(IsActive);

        AllEntitled := true;
        if ModuleReg.FindSet() then
            repeat
                if not VerifyEntitlement(ModuleReg."Module Code") then
                    AllEntitled := false;
            until ModuleReg.Next() = 0;

        IsActive := AllEntitled;
        Checked := true;

        exit(IsActive);
    end;

    procedure Invalidate()
    begin
        Clear(Checked);
        Clear(IsActive);
    end;

    local procedure VerifyEntitlement(ModuleCode: Code[20]): Boolean
    var
        Verify: Record "CG X108 Module Registration";
    begin
        Verify.Get(ModuleCode);
        exit(Verify.Entitled);
    end;
}
