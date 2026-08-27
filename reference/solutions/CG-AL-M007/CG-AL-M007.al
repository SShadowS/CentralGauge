report 70001 "Sales Performance Analysis"
{
    UsageCategory = ReportsAndAnalysis;
    ApplicationArea = All;
    Caption = 'Sales Performance Analysis';
    DefaultLayout = RDLC;
    RDLCLayout = 'SalesPerformanceAnalysis.rdl';

    dataset
    {
        dataitem(Customer; Customer)
        {
            RequestFilterFields = "No.", "Customer Posting Group", "Country/Region Code";

            column(No_Customer; "No.") { }
            column(Name_Customer; Name) { }
            column(Region_Customer; "Country/Region Code") { }
            column(Category_Customer; "Customer Posting Group") { }
            column(RunningTotalByCust; RunningTotalByCust) { }
            column(RunningTotalByReg; RunningTotalByReg) { }
            column(AvgOrderValue; AvgOrderValue) { }
            column(CustRank; CustRank) { }
            column(TopProduct; TopProduct) { }
            column(YoYComparison; YoYComparison) { }
            column(OrderFrequency; OrderFrequency) { }
            column(TotalSales; TotalSales) { }
            column(CustomerCount; CustomerCount) { }
            column(ShowDetails; ShowDetails) { }

            dataitem(SalesHeader; "Sales Header")
            {
                DataItemLink = "Sell-to Customer No." = FIELD("No.");
                DataItemTableView = sorting("Document Type", "No.") where("Document Type" = const(Order));

                column(DocNo_SalesHeader; "No.") { }
                column(PostingDate_SalesHeader; "Posting Date") { }

                dataitem(SalesLine; "Sales Line")
                {
                    DataItemLink = "Document Type" = FIELD("Document Type"), "Document No." = FIELD("No.");
                    DataItemTableView = sorting("Document Type", "Document No.", "Line No.");

                    column(LineNo_SalesLine; "Line No.") { }
                    column(Type_SalesLine; Format(Type)) { }
                    column(No_SalesLine; "No.") { }
                    column(Desc_SalesLine; Description) { }
                    column(Qty_SalesLine; Quantity) { }
                    column(UnitPrice_SalesLine; "Unit Price") { }
                    column(Amount_SalesLine; "Line Amount") { }
                    column(ProductSalesQty; ProductSalesQty) { }

                    trigger OnAfterGetRecord()
                    begin
                        ProductSalesQty := MockCalculator.GetProductSalesQuantity("No.");
                    end;
                }

                trigger OnPreDataItem()
                begin
                    if DateFilter <> '' then
                        SetFilter("Posting Date", DateFilter);
                end;
            }

            trigger OnPreDataItem()
            begin
                PreProcessSalesLines();
                TotalSales := MockCalculator.GetTotalSales();
                CustomerCount := MockCalculator.GetCustomerCount();
            end;

            trigger OnAfterGetRecord()
            var
                CurrSales: Decimal;
                PrevSales: Decimal;
                OrdCount: Integer;
                DaysInPeriod: Integer;
            begin
                RunningTotalByCust := MockCalculator.GetRunningTotalByCustomer("No.");
                RunningTotalByReg := MockCalculator.GetRunningTotalByRegion("Country/Region Code");
                AvgOrderValue := MockCalculator.CalculateAverageOrderValue();
                CustRank := MockCalculator.GetCustomerRank("No.");
                TopProduct := MockCalculator.GetTopProduct();
                
                CalculateCustYoY("No.", CurrSales, PrevSales);
                YoYComparison := MockCalculator.CalculateYoYComparison(CurrSales, PrevSales);
                
                OrdCount := GetOrderCount("No.");
                DaysInPeriod := GetDaysInPeriod();
                OrderFrequency := MockCalculator.CalculateOrderFrequency(OrdCount, DaysInPeriod);
            end;
        }
    }

    requestpage
    {
        layout
        {
            area(content)
            {
                group(Options)
                {
                    Caption = 'Options';
                    field(DateFilterField; DateFilter)
                    {
                        ApplicationArea = All;
                        Caption = 'Date Filter';
                        ToolTip = 'Specifies the date range for the sales analysis.';
                    }
                    field(ShowDetailsField; ShowDetails)
                    {
                        ApplicationArea = All;
                        Caption = 'Show Details';
                        ToolTip = 'Specifies whether to show detailed sales lines.';
                    }
                }
            }
        }
    }

    var
        MockCalculator: Codeunit "CG-AL-M007 Mock Calculator";
        RunningTotalByCust: Decimal;
        RunningTotalByReg: Decimal;
        AvgOrderValue: Decimal;
        CustRank: Integer;
        TopProduct: Code[20];
        YoYComparison: Decimal;
        OrderFrequency: Decimal;
        TotalSales: Decimal;
        CustomerCount: Integer;
        ProductSalesQty: Decimal;
        ShowDetails: Boolean;
        DateFilter: Text;

    local procedure PreProcessSalesLines()
    var
        SalesHeaderRec: Record "Sales Header";
        SalesLineRec: Record "Sales Line";
        CustRec: Record Customer;
    begin
        MockCalculator.Initialize();
        SalesHeaderRec.Reset();
        SalesHeaderRec.SetRange("Document Type", SalesHeaderRec."Document Type"::Order);
        if DateFilter <> '' then
            SalesHeaderRec.SetFilter("Posting Date", DateFilter);
        if SalesHeaderRec.FindSet() then
            repeat
                Clear(CustRec);
                if CustRec.Get(SalesHeaderRec."Sell-to Customer No.") then;
                SalesLineRec.Reset();
                SalesLineRec.SetRange("Document Type", SalesHeaderRec."Document Type");
                SalesLineRec.SetRange("Document No.", SalesHeaderRec."No.");
                if SalesLineRec.FindSet() then
                    repeat
                        MockCalculator.AddSalesLine(
                            SalesHeaderRec."Sell-to Customer No.",
                            CustRec."Country/Region Code",
                            SalesLineRec."No.",
                            SalesLineRec.Quantity,
                            SalesLineRec."Line Amount"
                        );
                    until SalesLineRec.Next() = 0;
            until SalesHeaderRec.Next() = 0;
    end;

    local procedure CalculateCustYoY(CustNo: Code[20]; var CurrSales: Decimal; var PrevSales: Decimal)
    var
        SalesHeaderRec: Record "Sales Header";
        SalesLineRec: Record "Sales Line";
        CurrYear: Integer;
    begin
        CurrSales := 0;
        PrevSales := 0;
        CurrYear := Date2DMY(WorkDate(), 3);
        
        SalesHeaderRec.Reset();
        SalesHeaderRec.SetRange("Document Type", SalesHeaderRec."Document Type"::Order);
        SalesHeaderRec.SetRange("Sell-to Customer No.", CustNo);
        if SalesHeaderRec.FindSet() then
            repeat
                if SalesHeaderRec."Posting Date" <> 0D then begin
                    if Date2DMY(SalesHeaderRec."Posting Date", 3) = CurrYear then begin
                        SalesLineRec.Reset();
                        SalesLineRec.SetRange("Document Type", SalesHeaderRec."Document Type");
                        SalesLineRec.SetRange("Document No.", SalesHeaderRec."No.");
                        SalesLineRec.CalcSums("Line Amount");
                        CurrSales += SalesLineRec."Line Amount";
                    end else if Date2DMY(SalesHeaderRec."Posting Date", 3) = CurrYear - 1 then begin
                        SalesLineRec.Reset();
                        SalesLineRec.SetRange("Document Type", SalesHeaderRec."Document Type");
                        SalesLineRec.SetRange("Document No.", SalesHeaderRec."No.");
                        SalesLineRec.CalcSums("Line Amount");
                        PrevSales += SalesLineRec."Line Amount";
                    end;
                end;
            until SalesHeaderRec.Next() = 0;
    end;

    local procedure GetOrderCount(CustNo: Code[20]): Integer
    var
        SalesHeaderRec: Record "Sales Header";
    begin
        SalesHeaderRec.Reset();
        SalesHeaderRec.SetRange("Document Type", SalesHeaderRec."Document Type"::Order);
        SalesHeaderRec.SetRange("Sell-to Customer No.", CustNo);
        if DateFilter <> '' then
            SalesHeaderRec.SetFilter("Posting Date", DateFilter);
        exit(SalesHeaderRec.Count());
    end;

    [TryFunction]
    local procedure TryGetDateRange(var MinDate: Date; var MaxDate: Date)
    var
        SalesHeaderRec: Record "Sales Header";
    begin
        SalesHeaderRec.Reset();
        SalesHeaderRec.SetFilter("Posting Date", DateFilter);
        MinDate := SalesHeaderRec.GetRangeMin("Posting Date");
        MaxDate := SalesHeaderRec.GetRangeMax("Posting Date");
    end;

    local procedure GetDaysInPeriod(): Integer
    var
        MinDate: Date;
        MaxDate: Date;
    begin
        if DateFilter = '' then
            exit(365);
        if TryGetDateRange(MinDate, MaxDate) then begin
            if (MinDate <> 0D) and (MaxDate <> 0D) then
                exit(MaxDate - MinDate + 1);
        end;
        exit(365);
    end;
}