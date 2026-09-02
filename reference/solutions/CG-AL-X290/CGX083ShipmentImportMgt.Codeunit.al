codeunit 70482 "CG X083 Shipment Import Mgt."
{
    // Called from the FreightEx gateway inbound handler once per shipment
    // status message.
    procedure ImportShipmentStatus(XmlPayload: Text)
    var
        Parser: Codeunit "CG X083 Shipment Status Parser";
        ImportEntry: Record "CG X083 Shipment Import Entry";
        TrackingNos: List of [Text];
    begin
        TrackingNos := Parser.GetTrackingNumbers(XmlPayload);

        ImportEntry.Init();
        ImportEntry."Shipment No." := CopyStr(Parser.GetShipmentNo(XmlPayload), 1, MaxStrLen(ImportEntry."Shipment No."));
        ImportEntry."Package Count" := Parser.CountPackages(XmlPayload);
        ImportEntry."Tracking No. Count" := TrackingNos.Count();
        ImportEntry."Weight Unit" := CopyStr(Parser.GetWeightUnit(XmlPayload), 1, MaxStrLen(ImportEntry."Weight Unit"));

        if ImportEntry."Package Count" = 0 then
            ImportEntry.Status := ImportEntry.Status::"Empty Shipment"
        else
            ImportEntry.Status := ImportEntry.Status::Received;

        ImportEntry."Imported At" := CurrentDateTime();
        ImportEntry.Insert(true);
    end;

    procedure GetLastImportedPackageCount(ShipmentNo: Code[20]): Integer
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
    begin
        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        if not ImportEntry.FindLast() then
            exit(0);
        exit(ImportEntry."Package Count");
    end;
}
