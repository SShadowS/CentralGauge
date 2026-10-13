codeunit 70219 "CGR Return Import"
{
    procedure ImportReturns(Payload: Text): Integer
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        Returns: JsonArray;
        ReturnToken: JsonToken;
        ReturnObject: JsonObject;
        FieldToken: JsonToken;
        ContractNo: Code[20];
        ReturnKm: Integer;
        ImportedCount: Integer;
    begin
        Returns.ReadFrom(Payload);
        foreach ReturnToken in Returns do begin
            ReturnObject := ReturnToken.AsObject();
            ReturnObject.Get('contractNo', FieldToken);
            ContractNo := CopyStr(FieldToken.AsValue().AsText(), 1, MaxStrLen(ContractNo));
            ReturnObject.Get('returnKm', FieldToken);
            ReturnKm := FieldToken.AsValue().AsInteger();
            RentalMgt.Return(ContractNo, ReturnKm, ReadDamage(ReturnObject));
            Commit();
            ImportedCount += 1;
        end;
        exit(ImportedCount);
    end;

    local procedure ReadDamage(ReturnObject: JsonObject): Text[100]
    var
        DamageToken: JsonToken;
    begin
        if not ReturnObject.Get('damage', DamageToken) then
            exit('');
        if DamageToken.AsValue().IsNull() then
            exit('');
        exit(CopyStr(DamageToken.AsValue().AsText(), 1, 100));
    end;
}
