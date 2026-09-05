codeunit 70052 "CG Type Converter"
{
    Access = Public;

    procedure IntegerToText(Value: Integer): Text
    begin
        exit(Format(Value));
    end;

    procedure DecimalToText(Value: Decimal): Text
    begin
        exit(Format(Value));
    end;

    procedure BooleanToText(Value: Boolean): Text
    begin
        exit(Format(Value));
    end;

    procedure DateToText(Value: Date): Text
    begin
        exit(Format(Value, 0, 9));
    end;

    procedure FormatOrderSummary(OrderNo: Integer; Amount: Decimal; IsShipped: Boolean; OrderDate: Date): Text
    begin
        exit(StrSubstNo(OrderSummaryLbl, IntegerToText(OrderNo), DecimalToText(Amount), BooleanToText(IsShipped), DateToText(OrderDate)));
    end;

    var
        OrderSummaryLbl: Label 'Order: %1, Amount: %2, Shipped: %3, Date: %4', Comment = '%1 = Order No., %2 = Amount, %3 = Shipped, %4 = Order Date';
}