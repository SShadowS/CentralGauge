codeunit 86601 "HX057 Fill Runner"
{
    var
        Buffer: Record "CGR Utilisation Buffer" temporary;
        VehicleFilter: Text;

    procedure SetVehicleFilter(NewVehicleFilter: Text)
    begin
        VehicleFilter := NewVehicleFilter;
    end;

    procedure AddLine(VehicleNo: Code[20]; Rentals: Integer; Revenue: Decimal)
    begin
        Buffer.Init();
        Buffer."Vehicle No." := VehicleNo;
        Buffer.Rentals := Rentals;
        Buffer.Revenue := Revenue;
        Buffer.Insert();
    end;

    procedure CopyBuffer(var Target: Record "CGR Utilisation Buffer" temporary)
    begin
        Target.Reset();
        Target.DeleteAll();
        Buffer.Reset();
        Buffer.SetCurrentKey("Vehicle No.");
        if Buffer.FindSet() then
            repeat
                Target := Buffer;
                Target.Insert();
            until Buffer.Next() = 0;
    end;

    trigger OnRun()
    var
        FleetUtilisation: Codeunit "CGR Fleet Utilisation";
    begin
        FleetUtilisation.FillUtilisation(VehicleFilter, Buffer);
    end;
}
