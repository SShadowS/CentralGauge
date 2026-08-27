codeunit 70123 "CG Partial Record Loader"
{
    Access = Public;

    procedure GetCustomerNames(): List of [Text]
    var
        Customer: Record Customer;
        CustomerNames: List of [Text];
    begin
        Customer.SetLoadFields(Name);
        if Customer.FindSet() then
            repeat
                CustomerNames.Add(Customer.Name);
            until Customer.Next() = 0;
        exit(CustomerNames);
    end;

    procedure GetItemBasicInfo(var ItemList: List of [Text])
    var
        Item: Record Item;
    begin
        Item.SetLoadFields("No.", Description);
        if Item.FindSet() then
            repeat
                ItemList.Add(Item."No." + ': ' + Item.Description);
            until Item.Next() = 0;
    end;

    procedure SumItemInventory(): Decimal
    var
        Item: Record Item;
        TotalInventory: Decimal;
    begin
        TotalInventory := 0;
        Item.SetLoadFields("No.");
        if Item.FindSet() then
            repeat
                Item.CalcFields(Inventory);
                TotalInventory += Item.Inventory;
            until Item.Next() = 0;
        exit(TotalInventory);
    end;

    procedure CountBlockedCustomers(): Integer
    var
        Customer: Record Customer;
    begin
        Customer.SetLoadFields("No.");
        Customer.SetRange(Blocked, Customer.Blocked::All);
        exit(Customer.Count());
    end;

    procedure GetHighValueItems(MinPrice: Decimal): List of [Code[20]]
    var
        Item: Record Item;
        HighValueItems: List of [Code[20]];
    begin
        Item.SetLoadFields("No.", "Unit Price");
        if Item.FindSet() then
            repeat
                if Item."Unit Price" >= MinPrice then
                    HighValueItems.Add(Item."No.");
            until Item.Next() = 0;
        exit(HighValueItems);
    end;
}