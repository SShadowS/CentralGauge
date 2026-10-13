codeunit 70515 "CGR Fleet Utilisation"
{
    procedure FillUtilisation(VehicleFilter: Text; var Buffer: Record "CGR Utilisation Buffer" temporary)
    var
        Utilisation: Query "CGR Vehicle Utilisation";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();

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
