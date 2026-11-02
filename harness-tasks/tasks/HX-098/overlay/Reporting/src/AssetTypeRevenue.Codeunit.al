codeunit 70521 "CGR Asset Type Revenue"
{
    procedure RevenueByAssetType(FromDate: Date; ToDate: Date; var Buffer: Record "CGR Asset Revenue Buffer")
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        AddTypeTotal(Buffer, "CGR Asset Type"::Car, FromDate, ToDate);
        AddTypeTotal(Buffer, "CGR Asset Type"::Van, FromDate, ToDate);
    end;

    local procedure AddTypeTotal(var Buffer: Record "CGR Asset Revenue Buffer"; AssetType: Enum "CGR Asset Type"; FromDate: Date; ToDate: Date)
    var
        Entry: Record "CGR Rental Ledger Entry";
        Vehicle: Record "CGR Vehicle";
    begin
        Buffer.Init();
        Buffer."Asset Type" := AssetType;
        Entry.SetRange("Posting Date", FromDate, ToDate);
        if Entry.FindSet() then
            repeat
                if Vehicle.Get(Entry."Vehicle No.") then
                    if Vehicle."Asset Type" = AssetType then begin
                        Buffer.Amount += Entry.Amount;
                        Buffer."Entry Count" += 1;
                    end;
            until Entry.Next() = 0;
        Buffer.Insert();
    end;
}
