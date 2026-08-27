codeunit 70120 "CG JSON Value Extractor"
{
    Access = Public;

    procedure ExtractProductInfo(ProductJson: JsonObject): Text
    var
        JsonTokenVar: JsonToken;
        ProductName: Text;
        Price: Decimal;
        InStock: Boolean;
        Quantity: Integer;
    begin
        if ProductJson.Get('name', JsonTokenVar) then
            ProductName := JsonTokenVar.AsValue().AsText();

        if ProductJson.Get('price', JsonTokenVar) then
            Price := JsonTokenVar.AsValue().AsDecimal();

        if ProductJson.Get('inStock', JsonTokenVar) then
            InStock := JsonTokenVar.AsValue().AsBoolean();

        if ProductJson.Get('quantity', JsonTokenVar) then
            Quantity := JsonTokenVar.AsValue().AsInteger();

        exit(StrSubstNo('Product: %1, Price: %2, In Stock: %3, Qty: %4', ProductName, Format(Price), Format(InStock), Quantity));
    end;

    procedure ExtractWithDefaults(DataJson: JsonObject; "Key": Text): Text
    var
        JsonTokenVar: JsonToken;
    begin
        if DataJson.Get("Key", JsonTokenVar) then
            exit(JsonTokenVar.AsValue().AsText());

        exit('N/A');
    end;

    procedure SumArrayValues(DataJson: JsonObject): Integer
    var
        JsonTokenVar: JsonToken;
        ValuesArray: JsonArray;
        ArrayElement: JsonToken;
        Total: Integer;
    begin
        Total := 0;

        if not DataJson.Get('values', JsonTokenVar) then
            exit(Total);

        ValuesArray := JsonTokenVar.AsArray();

        foreach ArrayElement in ValuesArray do
            Total += ArrayElement.AsValue().AsInteger();

        exit(Total);
    end;

    procedure ParseConfigSettings(ConfigJson: JsonObject): Dictionary of [Text, Text]
    var
        Settings: Dictionary of [Text, Text];
        JsonTokenVar: JsonToken;
        KeyName: Text;
    begin
        foreach KeyName in ConfigJson.Keys() do begin
            ConfigJson.Get(KeyName, JsonTokenVar);
            Settings.Add(KeyName, Format(JsonTokenVar.AsValue().AsText()));
        end;

        exit(Settings);
    end;

    procedure HandleMissingKeys(PartialJson: JsonObject): Text
    var
        JsonTokenVar: JsonToken;
    begin
        if PartialJson.Get('required', JsonTokenVar) then
            exit(JsonTokenVar.AsValue().AsText());

        if PartialJson.Get('optional', JsonTokenVar) then
            exit(JsonTokenVar.AsValue().AsText());

        exit('none');
    end;
}