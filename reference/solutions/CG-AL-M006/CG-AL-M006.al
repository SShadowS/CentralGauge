tableextension 70001 "Advanced Customer Extension" extends Customer
{
    fields
    {
        field(70001; "Credit Score"; Integer)
        {
            Caption = 'Credit Score';
            DataClassification = CustomerContent;

            trigger OnValidate()
            begin
                if ("Credit Score" < 300) or ("Credit Score" > 850) then
                    Error(CreditScoreRangeErr);

                UpdateRiskLevel();
                "Last Risk Assessment Date" := Today();
            end;
        }
        field(70002; "Risk Level"; Option)
        {
            Caption = 'Risk Level';
            DataClassification = CustomerContent;
            OptionMembers = Low,Medium,High,Critical;
            OptionCaption = 'Low,Medium,High,Critical';
            Editable = false;
        }
        field(70003; "Last Risk Assessment Date"; Date)
        {
            Caption = 'Last Risk Assessment Date';
            DataClassification = CustomerContent;

            trigger OnValidate()
            begin
                if "Last Risk Assessment Date" > Today() then
                    Error(FutureDateErr);
            end;
        }
        field(70004; "Payment History Rating"; Decimal)
        {
            Caption = 'Payment History Rating';
            DataClassification = CustomerContent;
            DecimalPlaces = 2 : 2;
            MinValue = 0;
            MaxValue = 100;
            Editable = false;
        }
        field(70005; "Preferred Payment Method"; Code[10])
        {
            Caption = 'Preferred Payment Method';
            DataClassification = CustomerContent;
            TableRelation = "Payment Method".Code;

            trigger OnValidate()
            var
                PaymentMethod: Record "Payment Method";
            begin
                if "Preferred Payment Method" <> '' then
                    if not PaymentMethod.Get("Preferred Payment Method") then
                        Error(InvalidPaymentMethodErr, "Preferred Payment Method");
            end;
        }
    }

    var
        CreditScoreRangeErr: Label 'Credit Score must be between 300 and 850.';
        FutureDateErr: Label 'Last Risk Assessment Date cannot be in the future.';
        InvalidPaymentMethodErr: Label 'Payment Method %1 does not exist.', Comment = '%1 = Payment Method Code';
        CreditScoreNotSetErr: Label 'Credit Score must be assigned before performing a risk assessment for customer %1.', Comment = '%1 = Customer No.';

    procedure UpdateRiskLevel()
    begin
        case "Credit Score" of
            670 .. 850:
                "Risk Level" := "Risk Level"::Low;
            580 .. 669:
                "Risk Level" := "Risk Level"::Medium;
            500 .. 579:
                "Risk Level" := "Risk Level"::High;
            300 .. 499:
                "Risk Level" := "Risk Level"::Critical;
            else
                "Risk Level" := "Risk Level"::Critical;
        end;
    end;

    procedure CalculatePaymentHistoryRating(): Decimal
    var
        CustLedgerEntry: Record "Cust. Ledger Entry";
        TotalInvoices: Integer;
        OnTimePayments: Integer;
        Rating: Decimal;
    begin
        TotalInvoices := 0;
        OnTimePayments := 0;

        CustLedgerEntry.SetRange("Customer No.", "No.");
        CustLedgerEntry.SetRange("Document Type", CustLedgerEntry."Document Type"::Invoice);
        CustLedgerEntry.SetRange(Open, false);
        if CustLedgerEntry.FindSet() then
            repeat
                TotalInvoices += 1;
                if (CustLedgerEntry."Closed at Date" <> 0D) and
                   (CustLedgerEntry."Closed at Date" <= CustLedgerEntry."Due Date")
                then
                    OnTimePayments += 1;
            until CustLedgerEntry.Next() = 0;

        if TotalInvoices = 0 then
            Rating := 50 // Neutral rating when no payment history exists
        else
            Rating := Round((OnTimePayments / TotalInvoices) * 100, 0.01);

        "Payment History Rating" := Rating;
        exit(Rating);
    end;

    procedure GetCreditLimit(): Decimal
    begin
        case "Risk Level" of
            "Risk Level"::Low:
                exit(100000);
            "Risk Level"::Medium:
                exit(50000);
            "Risk Level"::High:
                exit(10000);
            "Risk Level"::Critical:
                exit(1000);
        end;
        exit(0);
    end;

    procedure ValidateNewOrder(OrderAmount: Decimal): Boolean
    var
        CreditLimit: Decimal;
        CurrentBalance: Decimal;
    begin
        if OrderAmount <= 0 then
            exit(false);

        CreditLimit := GetCreditLimit();

        CalcFields("Balance (LCY)");
        CurrentBalance := "Balance (LCY)";

        exit((CurrentBalance + OrderAmount) <= CreditLimit);
    end;

    procedure TriggerRiskAssessment()
    begin
        if "Credit Score" = 0 then
            Error(CreditScoreNotSetErr, "No.");

        UpdateRiskLevel();
        CalculatePaymentHistoryRating();
        "Last Risk Assessment Date" := Today();
        Modify();
    end;
}