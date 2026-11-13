codeunit 88556 "HX173 Proposal Runner"
{
    var
        HX173Proposal: Record "CGR Workshop Task" temporary;
        HX173VehicleNo: Code[20];
        HX173AtDate: Date;
        HX173Result: Integer;

    procedure SetHX173Vehicle(VehicleNo: Code[20]; AtDate: Date)
    begin
        HX173VehicleNo := VehicleNo;
        HX173AtDate := AtDate;
    end;

    procedure HX173Added(): Integer
    begin
        exit(HX173Result);
    end;

    procedure ShareHX173Proposal(var Target: Record "CGR Workshop Task" temporary)
    begin
        Target.Copy(HX173Proposal, true);
    end;

    trigger OnRun()
    var
        Planning: Codeunit "CGR Workshop Planning";
    begin
        HX173Result := Planning.ProposeWorkshopTasks(HX173VehicleNo, HX173AtDate, HX173Proposal);
    end;
}
