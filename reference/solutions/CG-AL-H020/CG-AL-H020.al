codeunit 70020 "CG Collection Processor"
{
    procedure JoinTexts(Items: List of [Text]; Separator: Text): Text
    var
        Item: Text;
        Result: Text;
        IsFirst: Boolean;
    begin
        IsFirst := true;
        foreach Item in Items do begin
            if IsFirst then begin
                Result := Item;
                IsFirst := false;
            end else
                Result += Separator + Item;
        end;
        exit(Result);
    end;

    procedure FilterByPrefix(Items: List of [Text]; Prefix: Text): List of [Text]
    var
        Item: Text;
        FilteredItems: List of [Text];
    begin
        foreach Item in Items do
            if Item.StartsWith(Prefix) then
                FilteredItems.Add(Item);
        exit(FilteredItems);
    end;

    procedure SumDecimals(Numbers: List of [Decimal]): Decimal
    var
        Number: Decimal;
        Total: Decimal;
    begin
        foreach Number in Numbers do
            Total += Number;
        exit(Total);
    end;

    procedure MapToUpperCase(var Items: List of [Text])
    var
        i: Integer;
    begin
        for i := 1 to Items.Count() do
            Items.Set(i, UpperCase(Items.Get(i)));
    end;

    procedure MergeDictionaries(Dict1: Dictionary of [Text, Text]; Dict2: Dictionary of [Text, Text]): Dictionary of [Text, Text]
    var
        MergedDict: Dictionary of [Text, Text];
        KeyText: Text;
    begin
        foreach KeyText in Dict1.Keys() do
            MergedDict.Set(KeyText, Dict1.Get(KeyText));
        foreach KeyText in Dict2.Keys() do
            MergedDict.Set(KeyText, Dict2.Get(KeyText));
        exit(MergedDict);
    end;

    procedure GroupByFirstLetter(Items: List of [Text]): Dictionary of [Text, List of [Text]]
    var
        GroupedItems: Dictionary of [Text, List of [Text]];
        GroupList: List of [Text];
        Item: Text;
        FirstLetter: Text;
    begin
        foreach Item in Items do
            if Item <> '' then begin
                FirstLetter := CopyStr(Item, 1, 1);
                if GroupedItems.ContainsKey(FirstLetter) then begin
                    GroupList := GroupedItems.Get(FirstLetter);
                    GroupList.Add(Item);
                    GroupedItems.Set(FirstLetter, GroupList);
                end else begin
                    Clear(GroupList);
                    GroupList.Add(Item);
                    GroupedItems.Add(FirstLetter, GroupList);
                end;
            end;
        exit(GroupedItems);
    end;

    procedure GetKeys(Dict: Dictionary of [Code[20], Decimal]): List of [Code[20]]
    var
        KeyList: List of [Code[20]];
        KeyValue: Code[20];
    begin
        foreach KeyValue in Dict.Keys() do
            KeyList.Add(KeyValue);
        exit(KeyList);
    end;
}