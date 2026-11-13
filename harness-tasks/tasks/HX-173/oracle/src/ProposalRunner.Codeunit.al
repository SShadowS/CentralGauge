codeunit 88556 "HX173 Proposal Runner"
{
    var
        HX173Proposal: Record "CGR Workshop Task" temporary;
        HX173VehicleNo: Code[20];
        HX173AtDate: Date;
        HX173Result: Integer;
        HX173Accept: Boolean;

    procedure SetHX173Vehicle(VehicleNo: Code[20]; AtDate: Date)
    begin
        HX173VehicleNo := VehicleNo;
        HX173AtDate := AtDate;
        HX173Accept := false;
    end;

    procedure SetHX173Accept()
    begin
        HX173Accept := true;
    end;

    procedure HX173Added(): Integer
    begin
        exit(HX173Result);
    end;

    procedure ShareHX173Proposal(var Target: Record "CGR Workshop Task" temporary)
    begin
        Target.Copy(HX173Proposal, true);
        Target.Reset();
        Target.ClearMarks();
        Target.MarkedOnly(false);
        Target.SetCurrentKey("Entry No.");
    end;

    trigger OnRun()
    var
        Planning: Codeunit "CGR Workshop Planning";
    begin
        if HX173Accept then
            HX173Result := Planning.AcceptWorkshopProposal(HX173Proposal)
        else
            HX173Result := Planning.ProposeWorkshopTasks(HX173VehicleNo, HX173AtDate, HX173Proposal);
    end;
}
