codeunit 69097 "CG-AL-M007 Mock Calculator"
{
    // Mock implementation of Sales Performance Analysis calculations for testing
    // This exposes the calculation logic that should be implemented in the report

    var
        RunningTotalByCust: Dictionary of [Code[20], Decimal];
        RunningTotalByRegion: Dictionary of [Code[10], Decimal];
        CustomerSalesVolume: Dictionary of [Code[20], Decimal];
        ProductSalesQty: Dictionary of [Code[20], Decimal];
        OrderValues: List of [Decimal];

    procedure Initialize()
    begin
        Clear(RunningTotalByCust);
        Clear(RunningTotalByRegion);
        Clear(CustomerSalesVolume);
        Clear(ProductSalesQty);
        Clear(OrderValues);
    end;

    procedure AddSalesLine(CustomerNo: Code[20]; RegionCode: Code[10]; ItemNo: Code[20]; Quantity: Decimal; Amount: Decimal)
    var
        CurrentTotal: Decimal;
        CurrentQty: Decimal;
    begin
        // Update running total by customer
        if RunningTotalByCust.ContainsKey(CustomerNo) then
            CurrentTotal := RunningTotalByCust.Get(CustomerNo)
        else
            CurrentTotal := 0;
        RunningTotalByCust.Set(CustomerNo, CurrentTotal + Amount);

        // Update running total by region
        if RunningTotalByRegion.ContainsKey(RegionCode) then
            CurrentTotal := RunningTotalByRegion.Get(RegionCode)
        else
            CurrentTotal := 0;
        RunningTotalByRegion.Set(RegionCode, CurrentTotal + Amount);

        // Update customer sales volume
        if CustomerSalesVolume.ContainsKey(CustomerNo) then
            CurrentTotal := CustomerSalesVolume.Get(CustomerNo)
        else
            CurrentTotal := 0;
        CustomerSalesVolume.Set(CustomerNo, CurrentTotal + Amount);

        // Update product sales quantity
        if ProductSalesQty.ContainsKey(ItemNo) then
            CurrentQty := ProductSalesQty.Get(ItemNo)
        else
            CurrentQty := 0;
        ProductSalesQty.Set(ItemNo, CurrentQty + Quantity);

        // Track order value for averaging
        OrderValues.Add(Amount);
    end;

    procedure GetRunningTotalByCustomer(CustomerNo: Code[20]): Decimal
    begin
        if RunningTotalByCust.ContainsKey(CustomerNo) then
            exit(RunningTotalByCust.Get(CustomerNo));
        exit(0);
    end;

    procedure GetRunningTotalByRegion(RegionCode: Code[10]): Decimal
    begin
        if RunningTotalByRegion.ContainsKey(RegionCode) then
            exit(RunningTotalByRegion.Get(RegionCode));
        exit(0);
    end;

    procedure CalculateAverageOrderValue(): Decimal
    var
        Total: Decimal;
        Value: Decimal;
    begin
        if OrderValues.Count() = 0 then
            exit(0);

        Total := 0;
        foreach Value in OrderValues do
            Total += Value;

        exit(Total / OrderValues.Count());
    end;

    procedure GetCustomerRank(CustomerNo: Code[20]): Integer
    var
        CustNo: Code[20];
        CustSales: Decimal;
        TargetSales: Decimal;
        Rank: Integer;
    begin
        if not CustomerSalesVolume.ContainsKey(CustomerNo) then
            exit(0);

        TargetSales := CustomerSalesVolume.Get(CustomerNo);
        Rank := 1;

        foreach CustNo in CustomerSalesVolume.Keys() do begin
            CustSales := CustomerSalesVolume.Get(CustNo);
            if CustSales > TargetSales then
                Rank += 1;
        end;

        exit(Rank);
    end;

    procedure GetTopProduct(): Code[20]
    var
        TopItemNo: Code[20];
        ItemNo: Code[20];
        TopQty: Decimal;
        CurrentQty: Decimal;
    begin
        TopQty := 0;
        TopItemNo := '';

        foreach ItemNo in ProductSalesQty.Keys() do begin
            CurrentQty := ProductSalesQty.Get(ItemNo);
            if CurrentQty > TopQty then begin
                TopQty := CurrentQty;
                TopItemNo := ItemNo;
            end;
        end;

        exit(TopItemNo);
    end;

    procedure GetProductSalesQuantity(ItemNo: Code[20]): Decimal
    begin
        if ProductSalesQty.ContainsKey(ItemNo) then
            exit(ProductSalesQty.Get(ItemNo));
        exit(0);
    end;

    procedure GetTotalSales(): Decimal
    var
        Total: Decimal;
        CustNo: Code[20];
    begin
        Total := 0;
        foreach CustNo in CustomerSalesVolume.Keys() do
            Total += CustomerSalesVolume.Get(CustNo);
        exit(Total);
    end;

    procedure GetCustomerCount(): Integer
    begin
        exit(CustomerSalesVolume.Count());
    end;

    procedure CalculateYoYComparison(CurrentYearSales: Decimal; PreviousYearSales: Decimal): Decimal
    begin
        // Returns percentage change
        if PreviousYearSales = 0 then begin
            if CurrentYearSales > 0 then
                exit(100); // 100% growth from zero
            exit(0);
        end;
        exit(((CurrentYearSales - PreviousYearSales) / PreviousYearSales) * 100);
    end;

    procedure CalculateOrderFrequency(OrderCount: Integer; DaysInPeriod: Integer): Decimal
    begin
        // Returns orders per day
        if DaysInPeriod = 0 then
            exit(0);
        exit(OrderCount / DaysInPeriod);
    end;
}
