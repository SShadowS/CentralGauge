page 70038 "CGFqnCustomerView"
{
    Caption = 'CG FQN Customer View';
    PageType = Card;
    SourceTable = Microsoft.Sales.Customer.Customer;
    ApplicationArea = All;
    UsageCategory = None;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("No."; Rec."No.")
                {
                    ApplicationArea = All;
                }
                field(Name; Rec.Name)
                {
                    ApplicationArea = All;
                }
            }
        }
    }
}
