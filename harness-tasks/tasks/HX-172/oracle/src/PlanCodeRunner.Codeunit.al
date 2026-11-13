codeunit 88541 "HX172 Plan Code Runner"
{
    var
        FromPlanCode: Code[20];
        ToPlanCode: Code[20];

    trigger OnRun()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        ServicePlanMgt.ChangePlanCode(FromPlanCode, ToPlanCode);
    end;

    procedure SetPlanCodePair(OldCode: Code[20]; NewCode: Code[20])
    begin
        FromPlanCode := OldCode;
        ToPlanCode := NewCode;
    end;
}
