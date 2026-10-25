page 50209 "UI Sample Tabular Mix Bad"
{
    PageType = Card;
    SourceTable = "Cust. Ledger Entry";

    layout
    {
        area(Content)
        {
            grid(StatementGrid)
            {
                GridLayout = Columns;
                group(Periods)
                {
                    ShowCaption = false;
                    field(StatementPeriod; Rec."Posting Date")
                    {
                        ApplicationArea = All;
                        Editable = false;
                        ShowCaption = false;
                    }
                }
                group(Balances)
                {
                    ShowCaption = false;
                    field(StatementBalance; Rec.Amount)
                    {
                        ApplicationArea = All;
                        Editable = false;
                        ShowCaption = false;
                    }
                    field(DueDate; Rec."Due Date")
                    {
                        ApplicationArea = All;
                    }
                }
            }
        }
    }
}
