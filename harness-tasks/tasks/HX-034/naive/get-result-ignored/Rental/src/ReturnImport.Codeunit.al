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
        Damage: Text[100];
        ImportedCount: Integer;
    begin
        Returns.ReadFrom(Payload);
        foreach ReturnToken in Returns do begin
            ReturnObject := ReturnToken.AsObject();
            ReturnObject.Get('contractNo', FieldToken);
            ContractNo := CopyStr(FieldToken.AsValue().AsText(), 1, MaxStrLen(ContractNo));
            ReturnObject.Get('returnKm', FieldToken);
            ReturnKm := FieldToken.AsValue().AsInteger();
            ReturnObject.Get('damage', FieldToken);
            if FieldToken.AsValue().IsNull() then
                Damage := ''
            else
                Damage := CopyStr(FieldToken.AsValue().AsText(), 1, MaxStrLen(Damage));
            RentalMgt.Return(ContractNo, ReturnKm, Damage);
            ImportedCount += 1;
        end;
        exit(ImportedCount);
    end;
}
