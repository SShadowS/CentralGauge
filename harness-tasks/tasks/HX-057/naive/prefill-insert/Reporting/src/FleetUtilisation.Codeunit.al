codeunit 70515 "CGR Fleet Utilisation"
{
    procedure FillUtilisation(VehicleFilter: Text; var Buffer: Record "CGR Utilisation Buffer" temporary)
    var
        Vehicle: Record "CGR Vehicle";
        Utilisation: Query "CGR Vehicle Utilisation";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();

        Vehicle.SetFilter("No.", VehicleFilter);
        if Vehicle.FindSet() then
            repeat
                Buffer.Init();
                Buffer."Vehicle No." := Vehicle."No.";
                Buffer.Insert();
            until Vehicle.Next() = 0;

        Utilisation.SetFilter(VehicleNo, VehicleFilter);
        Utilisation.Open();
        while Utilisation.Read() do begin
            Buffer.Init();
            Buffer."Vehicle No." := Utilisation.VehicleNo;
            Buffer.Rentals := Utilisation.Rentals;
            Buffer.Revenue := Utilisation.Revenue;
            Buffer.Insert();
        end;
        Utilisation.Close();
    end;
}
