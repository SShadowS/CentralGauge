codeunit 70014 "CG JSON Parser"
{
    procedure ParseCustomerData(CustomerJson: JsonObject): Text
    var
        Name: Text;
        Age: Integer;
        Active: Boolean;
    begin
        Name := CustomerJson.GetText('name');
        Age := CustomerJson.GetInteger('age');
        Active := CustomerJson.GetBoolean('active');
        exit(StrSubstNo('Name: %1, Age: %2, Active: %3', Name, Age, Active));
    end;

    procedure ProcessOrderItems(OrderJson: JsonObject): Integer
    var
        ItemsArray: JsonArray;
        ItemToken: JsonToken;
        ItemObject: JsonObject;
        TotalQuantity: Integer;
    begin
        ItemsArray := OrderJson.GetArray('items');
        foreach ItemToken in ItemsArray do begin
            ItemObject := ItemToken.AsObject();
            TotalQuantity += ItemObject.GetInteger('quantity');
        end;
        exit(TotalQuantity);
    end;

    procedure SafeGetText(Obj: JsonObject; "Key": Text; DefaultValue: Text): Text
    begin
        if Obj.Contains("Key") then
            exit(Obj.GetText("Key"));
        exit(DefaultValue);
    end;

    procedure ExtractNestedValue(RootJson: JsonObject): Decimal
    var
        DataToken: JsonToken;
        DetailsToken: JsonToken;
        DataObject: JsonObject;
        DetailsObject: JsonObject;
    begin
        if not RootJson.Get('data', DataToken) then
            Error('Missing "data" object in JSON.');
        DataObject := DataToken.AsObject();

        if not DataObject.Get('details', DetailsToken) then
            Error('Missing "details" object in JSON.');
        DetailsObject := DetailsToken.AsObject();

        exit(DetailsObject.GetDecimal('amount'));
    end;
}